// Miracle - Video Downloader companion app (native messaging host).
//
// The extension talks to this program over stdin/stdout using Chrome's native
// messaging framing (4-byte little-endian length + UTF-8 JSON). It runs
// yt-dlp + ffmpeg, which live next to this executable, for sites the
// extension cannot download by itself (YouTube).
//
// Built by install.ps1 with the C# compiler that ships with Windows.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

static class Host
{
    const string Version = "0.3.0";

    static readonly object WriteLock = new object();
    static readonly Dictionary<string, Process> Jobs = new Dictionary<string, Process>();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
    static readonly string Dir = AppDomain.CurrentDomain.BaseDirectory;
    static readonly string YtDlp = Path.Combine(Dir, "yt-dlp.exe");
    static Stream stdout;

    static void Main()
    {
        stdout = Console.OpenStandardOutput();
        Stream stdin = Console.OpenStandardInput();
        while (true)
        {
            Dictionary<string, object> msg = Read(stdin);
            if (msg == null) break; // browser closed the port
            ThreadPool.QueueUserWorkItem(_ => Handle(msg));
        }
        lock (Jobs)
            foreach (Process p in Jobs.Values) Kill(p);
    }

    // ------------------------------------------------------------------
    // Native messaging framing

    static Dictionary<string, object> Read(Stream input)
    {
        byte[] lenBytes = ReadExactly(input, 4);
        if (lenBytes == null) return null;
        int len = BitConverter.ToInt32(lenBytes, 0);
        byte[] body = ReadExactly(input, len);
        if (body == null) return null;
        return Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
    }

    static byte[] ReadExactly(Stream input, int count)
    {
        byte[] buf = new byte[count];
        int got = 0;
        while (got < count)
        {
            int n = input.Read(buf, got, count - got);
            if (n <= 0) return null;
            got += n;
        }
        return buf;
    }

    static void Send(Dictionary<string, object> msg)
    {
        byte[] body = Encoding.UTF8.GetBytes(Json.Serialize(msg));
        lock (WriteLock)
        {
            stdout.Write(BitConverter.GetBytes(body.Length), 0, 4);
            stdout.Write(body, 0, body.Length);
            stdout.Flush();
        }
    }

    static Dictionary<string, object> Obj(params object[] kv)
    {
        var d = new Dictionary<string, object>();
        for (int i = 0; i < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
        return d;
    }

    static string Str(Dictionary<string, object> msg, string key)
    {
        object v;
        return msg.TryGetValue(key, out v) && v != null ? Convert.ToString(v) : null;
    }

    // ------------------------------------------------------------------
    // Requests

    static void Handle(Dictionary<string, object> msg)
    {
        string type = Str(msg, "type");
        string reqId = Str(msg, "reqId");
        try
        {
            switch (type)
            {
                case "ping":
                    Reply(reqId, Obj("version", Version, "ytdlp", RunCapture("--version").Trim()));
                    break;
                case "info":
                    Reply(reqId, Info(Str(msg, "url")));
                    break;
                case "download":
                    Download(msg);
                    Reply(reqId, Obj());
                    break;
                case "cancel":
                    Cancel(Str(msg, "jobId"));
                    Reply(reqId, Obj());
                    break;
                case "reveal":
                    Reveal(Str(msg, "path"));
                    Reply(reqId, Obj());
                    break;
                case "update":
                    Reply(reqId, Obj("output", RunCapture("-U").Trim()));
                    break;
                default:
                    throw new Exception("Unknown request: " + type);
            }
        }
        catch (Exception e)
        {
            Send(Obj("reqId", reqId, "ok", false, "error", e.Message));
        }
    }

    static void Reply(string reqId, Dictionary<string, object> data)
    {
        data["reqId"] = reqId;
        data["ok"] = true;
        Send(data);
    }

    // Video metadata and the qualities that can be offered.
    static Dictionary<string, object> Info(string url)
    {
        string json = RunCapture("-J", "--no-playlist", "--no-warnings", url);
        var info = Json.Deserialize<Dictionary<string, object>>(json);
        var heights = new SortedSet<int>();
        var formats = info.ContainsKey("formats") ? info["formats"] as System.Collections.ArrayList : null;
        if (formats != null)
        {
            foreach (Dictionary<string, object> f in formats)
            {
                string vcodec = Str(f, "vcodec");
                object h;
                if (vcodec != null && vcodec != "none" && f.TryGetValue("height", out h) && h != null)
                    heights.Add(Convert.ToInt32(h));
            }
        }
        var list = new List<int>(heights);
        list.Reverse();
        return Obj(
            "id", Str(info, "id"),
            "title", Str(info, "title"),
            "uploader", Str(info, "uploader"),
            "duration", info.ContainsKey("duration") ? info["duration"] : null,
            "thumbnail", Str(info, "thumbnail"),
            "isLive", Str(info, "is_live") == "True",
            "heights", list);
    }

    static readonly Regex ProgressLine = new Regex(@"^AVD\|([^|]*)\|\s*([\d.]+)%\|([^|]*)\|(.*)$");

    static void Download(Dictionary<string, object> msg)
    {
        string jobId = Str(msg, "jobId");
        string url = Str(msg, "url");
        bool audioOnly = Str(msg, "audioOnly") == "True";
        int height = 0;
        int.TryParse(Str(msg, "height"), out height);

        var args = new List<string> {
            "--no-playlist", "--no-mtime", "--newline", "--progress", "--encoding", "utf-8",
            "--ffmpeg-location", Dir,
            "-P", DownloadsFolder(),
            "-o", "%(title).150B [%(id)s].%(ext)s",
            "--progress-template", "download:AVD|%(info.format_id)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
            "--print", "after_move:AVDFILE|%(filepath)s",
        };
        if (audioOnly)
        {
            args.AddRange(new[] { "-f", "ba[ext=m4a]/ba", "-x", "--audio-format", "m4a" });
        }
        else
        {
            // Prefer H.264 + AAC in MP4 so the result plays in any Windows player;
            // above 1080p YouTube only has VP9/AV1, which the resolution still wins over.
            args.AddRange(new[] { "-f", "bv*+ba/b", "-S", (height > 0 ? "res:" + height + "," : "") + "vcodec:h264,ext:mp4:m4a", "--merge-output-format", "mp4" });
        }
        args.Add(url);

        Process p = Start(args.ToArray());
        lock (Jobs) Jobs[jobId] = p;

        var phases = new List<string>();
        string file = null;
        var errors = new StringBuilder();
        p.ErrorDataReceived += (s, e) =>
        {
            if (e.Data != null && e.Data.StartsWith("ERROR")) errors.AppendLine(e.Data);
        };
        p.OutputDataReceived += (s, e) =>
        {
            if (e.Data == null) return;
            if (e.Data.StartsWith("AVDFILE|"))
            {
                file = e.Data.Substring(8);
                return;
            }
            Match m = ProgressLine.Match(e.Data);
            if (!m.Success) return;
            string format = m.Groups[1].Value;
            if (!phases.Contains(format)) phases.Add(format);
            // Video and audio download one after another; split the bar between them.
            int total = audioOnly ? 1 : Math.Max(2, phases.Count);
            double pct = double.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture) / 100.0;
            double progress = (phases.IndexOf(format) + pct) / total;
            bool merging = !audioOnly && phases.Count >= 2 && pct >= 1.0 && phases.IndexOf(format) == phases.Count - 1;
            Send(Obj("type", "progress", "jobId", jobId, "progress", Math.Min(progress, 1.0),
                "speed", m.Groups[3].Value.Trim(), "eta", m.Groups[4].Value.Trim(),
                "status", merging ? "merging" : "downloading"));
        };
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        p.WaitForExit();

        bool cancelled;
        lock (Jobs)
        {
            cancelled = !Jobs.ContainsKey(jobId);
            Jobs.Remove(jobId);
        }
        if (cancelled)
            Send(Obj("type", "cancelled", "jobId", jobId));
        else if (p.ExitCode == 0 && file != null)
            Send(Obj("type", "done", "jobId", jobId, "file", file));
        else
            Send(Obj("type", "error", "jobId", jobId, "error", errors.Length > 0 ? errors.ToString().Trim() : "yt-dlp exited with code " + p.ExitCode));
    }

    static void Cancel(string jobId)
    {
        Process p;
        lock (Jobs)
        {
            if (!Jobs.TryGetValue(jobId, out p)) return;
            Jobs.Remove(jobId);
        }
        Kill(p);
    }

    static void Reveal(string path)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path)) throw new Exception("File not found");
        Process.Start("explorer.exe", "/select,\"" + path + "\"");
    }

    // ------------------------------------------------------------------
    // Process helpers

    static Process Start(params string[] args)
    {
        if (!File.Exists(YtDlp)) throw new Exception("yt-dlp.exe is missing; run the installer again");
        var psi = new ProcessStartInfo(YtDlp, JoinArgs(args))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            // Never let yt-dlp inherit our stdin: it is the browser's pipe, and with a
            // read pending on it the child blocks during startup.
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            WorkingDirectory = Dir,
        };
        psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        Process p = Process.Start(psi);
        p.StandardInput.Close();
        return p;
    }

    static string RunCapture(params string[] args)
    {
        Process p = Start(args);
        var err = p.StandardError.ReadToEndAsync();
        string output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        if (p.ExitCode != 0)
        {
            string msg = err.Result.Trim();
            int i = msg.LastIndexOf("ERROR:", StringComparison.Ordinal);
            throw new Exception(i >= 0 ? msg.Substring(i) : (msg.Length > 0 ? msg : "yt-dlp failed"));
        }
        return output;
    }

    static void Kill(Process p)
    {
        try
        {
            // yt-dlp spawns ffmpeg; take the whole tree down.
            Process.Start(new ProcessStartInfo("taskkill", "/T /F /PID " + p.Id) { CreateNoWindow = true, UseShellExecute = false, RedirectStandardInput = true }).WaitForExit();
        }
        catch { }
    }

    // Quotes arguments the way the MSVC runtime (and Python) parse them.
    static string JoinArgs(string[] args)
    {
        var sb = new StringBuilder();
        foreach (string arg in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
            {
                sb.Append(arg);
                continue;
            }
            sb.Append('"');
            int backslashes = 0;
            foreach (char c in arg)
            {
                if (c == '\\') { backslashes++; continue; }
                if (c == '"') sb.Append('\\', backslashes * 2 + 1);
                else sb.Append('\\', backslashes);
                backslashes = 0;
                sb.Append(c);
            }
            sb.Append('\\', backslashes * 2);
            sb.Append('"');
        }
        return sb.ToString();
    }

    [DllImport("shell32.dll")]
    static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, out IntPtr path);

    static string DownloadsFolder()
    {
        IntPtr ptr;
        if (SHGetKnownFolderPath(new Guid("374DE290-123F-4565-9164-39C4925E467B"), 0, IntPtr.Zero, out ptr) == 0)
        {
            string path = Marshal.PtrToStringUni(ptr);
            Marshal.FreeCoTaskMem(ptr);
            return path;
        }
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
    }
}
