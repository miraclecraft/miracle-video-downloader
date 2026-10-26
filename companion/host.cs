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
    const string Version = "1.1.0";

    static readonly object WriteLock = new object();
    static readonly Dictionary<string, Process> Jobs = new Dictionary<string, Process>();
    // Jobs being stopped by "pause" rather than "cancel": their partial files are kept.
    static readonly HashSet<string> Pausing = new HashSet<string>();
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
                    Reply(reqId, Info(Str(msg, "url"), Str(msg, "cookies")));
                    break;
                case "download":
                    Download(msg);
                    Reply(reqId, Obj());
                    break;
                case "pause":
                    Pause(Str(msg, "jobId"));
                    Reply(reqId, Obj());
                    break;
                case "cancel":
                    Cancel(Str(msg, "jobId"), msg.ContainsKey("partials") ? msg["partials"] as System.Collections.ArrayList : null);
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

    // Video metadata and the qualities that can be offered. A page with several
    // videos comes back as a playlist; the first one is offered, and its own URL
    // is what gets downloaded.
    static Dictionary<string, object> Info(string url, string cookies)
    {
        string cookieFile = WriteCookies(cookies);
        string json;
        try
        {
            var args = new List<string> { "-J", "--no-playlist", "--no-warnings" };
            if (cookieFile != null) args.AddRange(new[] { "--cookies", cookieFile });
            args.Add(url);
            json = RunCapture(args.ToArray());
        }
        finally
        {
            DeleteQuietly(cookieFile);
        }
        var info = Json.Deserialize<Dictionary<string, object>>(json);
        int count = 1, item = 0;
        if (Str(info, "_type") == "playlist")
        {
            string pageUrl = Str(info, "webpage_url") ?? url;
            var entries = info.ContainsKey("entries") ? info["entries"] as System.Collections.ArrayList : null;
            Dictionary<string, object> first = null;
            if (entries != null)
                for (int i = 0; i < entries.Count && first == null; i++)
                    if (entries[i] is Dictionary<string, object>) { first = (Dictionary<string, object>)entries[i]; item = i + 1; }
            if (first == null) throw new Exception("No video found on this page");
            count = entries.Count;
            info = first;
            // Videos embedded in a page share its URL; only their position picks one.
            if ((Str(info, "webpage_url") ?? pageUrl) != pageUrl) item = 0;
        }
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
            "url", Str(info, "webpage_url") ?? Str(info, "original_url") ?? url,
            "site", Str(info, "extractor_key"),
            "count", count,
            "item", item,
            "id", Str(info, "id"),
            "title", Str(info, "title"),
            "uploader", Str(info, "uploader"),
            "duration", info.ContainsKey("duration") ? info["duration"] : null,
            "thumbnail", Str(info, "thumbnail"),
            "isLive", Str(info, "is_live") == "True",
            "heights", list);
    }

    // AVD|format|downloaded|total|total estimate|speed|eta ("NA" when yt-dlp doesn't know).
    static readonly Regex ProgressLine = new Regex(@"^AVD\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)$");
    static readonly Regex Destination = new Regex(@"^\[download\] Destination: (.+)$");
    // Seen when a paused download resumes after one of its parts already finished.
    static readonly Regex AlreadyDone = new Regex(@"^\[download\] (.+) has already been downloaded$");

    static double Num(string s)
    {
        double v;
        // NaN/Infinity would serialize to invalid JSON and break the message channel.
        return double.TryParse(s.Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v)
            && !double.IsNaN(v) && !double.IsInfinity(v) ? v : 0;
    }

    static void Download(Dictionary<string, object> msg)
    {
        string jobId = Str(msg, "jobId");
        string url = Str(msg, "url");
        bool audioOnly = Str(msg, "audioOnly") == "True";
        int height = 0;
        int.TryParse(Str(msg, "height"), out height);

        var args = new List<string> {
            // --print implies --quiet, which hides the "Destination:" lines naming the partial files.
            "--no-playlist", "--no-mtime", "--newline", "--progress", "--no-quiet", "--encoding", "utf-8",
            "--ffmpeg-location", Dir,
            "-P", DownloadsFolder(),
            "-o", "%(title).150B [%(id)s].%(ext)s",
            "--progress-template", "download:AVD|%(info.format_id)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
            // Size of everything that will be downloaded (video + audio), for "x of y".
            "--print", "before_dl:AVDSIZE|%(filesize,filesize_approx)s",
            "--print", "after_move:AVDFILE|%(filepath)s",
        };
        if (audioOnly)
        {
            // Sites without a separate audio stream: take the video and extract its audio.
            args.AddRange(new[] { "-f", "ba[ext=m4a]/ba/b", "-x", "--audio-format", "m4a" });
        }
        else
        {
            // Prefer H.264 + AAC in MP4 so the result plays in any Windows player;
            // above 1080p YouTube only has VP9/AV1, which the resolution still wins over.
            // MKV is the fallback for streams MP4 can't hold.
            args.AddRange(new[] { "-f", "bv*+ba/b", "-S", (height > 0 ? "res:" + height + "," : "") + "vcodec:h264,ext:mp4:m4a", "--merge-output-format", "mp4/mkv" });
        }
        int item = 0;
        int.TryParse(Str(msg, "item"), out item);
        if (item > 0) args.AddRange(new[] { "--playlist-items", item.ToString() });
        string cookieFile = WriteCookies(Str(msg, "cookies"));
        if (cookieFile != null) args.AddRange(new[] { "--cookies", cookieFile });
        args.Add(url);

        Process p;
        try
        {
            p = Start(args.ToArray());
        }
        catch
        {
            DeleteQuietly(cookieFile);
            throw;
        }
        lock (Jobs) Jobs[jobId] = p;

        // Video and audio download one after another (each is a "phase").
        var phases = new List<string>();
        var phaseBytes = new Dictionary<string, double>();
        var partials = new List<string>();
        double expected = 0;
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
            if (e.Data.StartsWith("AVDSIZE|"))
            {
                expected = Num(e.Data.Substring(8));
                return;
            }
            Match d = Destination.Match(e.Data);
            if (d.Success)
            {
                lock (partials) partials.Add(d.Groups[1].Value.Trim());
                return;
            }
            Match a = AlreadyDone.Match(e.Data);
            if (a.Success)
            {
                string path = a.Groups[1].Value.Trim();
                lock (partials) partials.Add(path);
                if (!phases.Contains(path)) phases.Add(path);
                try { phaseBytes[path] = new FileInfo(path).Length; } catch { phaseBytes[path] = 0; }
                return;
            }
            Match m = ProgressLine.Match(e.Data);
            if (!m.Success) return;
            string format = m.Groups[1].Value;
            if (!phases.Contains(format)) phases.Add(format);
            double done = Num(m.Groups[2].Value);
            double size = Num(m.Groups[3].Value);
            if (size <= 0) size = Num(m.Groups[4].Value);
            phaseBytes[format] = done;

            double bytes = 0, finishedSize = 0;
            foreach (string f in phases)
            {
                bytes += phaseBytes[f];
                if (f != format) finishedSize += phaseBytes[f];
            }
            // Prefer yt-dlp's total for the whole download; otherwise what we know so far.
            bool useExpected = expected > bytes;
            double total = useExpected ? expected : finishedSize + size;
            double progress = total > 0 ? Math.Min(bytes / total, 1.0) : 0;
            bool merging = !audioOnly && phases.Count >= 2 && size > 0 && done >= size;
            Send(Obj("type", "progress", "jobId", jobId, "progress", progress,
                "bytes", bytes, "total", total, "totalEstimated", !useExpected && Num(m.Groups[3].Value) <= 0,
                "speed", Num(m.Groups[5].Value), "eta", Num(m.Groups[6].Value),
                "status", merging ? "merging" : "downloading"));
        };
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        p.WaitForExit();
        DeleteQuietly(cookieFile);

        bool stopped, paused;
        lock (Jobs)
        {
            stopped = !Jobs.ContainsKey(jobId);
            paused = Pausing.Remove(jobId);
            Jobs.Remove(jobId);
        }
        if (paused)
        {
            // yt-dlp continues from the .part files when the same download runs again.
            Send(Obj("type", "paused", "jobId", jobId, "partials", partials));
        }
        else if (stopped)
        {
            DeletePartials(partials);
            Send(Obj("type", "cancelled", "jobId", jobId));
        }
        else if (p.ExitCode == 0 && file != null)
            Send(Obj("type", "done", "jobId", jobId, "file", file));
        else
            Send(Obj("type", "error", "jobId", jobId, "error", errors.Length > 0 ? errors.ToString().Trim() : "yt-dlp exited with code " + p.ExitCode));
    }

    static void Pause(string jobId)
    {
        Process p;
        lock (Jobs)
        {
            if (!Jobs.TryGetValue(jobId, out p)) return;
            Jobs.Remove(jobId);
            Pausing.Add(jobId);
        }
        Kill(p);
    }

    // A running job is stopped (it cleans up when its process exits); a paused one
    // has no process, so the extension passes the partial files it was told about.
    static void Cancel(string jobId, System.Collections.ArrayList partials)
    {
        Process p;
        lock (Jobs)
        {
            if (!Jobs.TryGetValue(jobId, out p))
            {
                if (partials != null)
                {
                    var paths = new List<string>();
                    foreach (object o in partials) paths.Add(Convert.ToString(o));
                    DeletePartials(paths);
                }
                return;
            }
            Jobs.Remove(jobId);
        }
        Kill(p);
    }

    // Removes what an unfinished download left behind. Only touches files in the
    // Downloads folder: "*.part" / "*.ytdl" leftovers and per-format intermediates
    // ("Title [id].f137.mp4"), never a finished video.
    static readonly Regex Intermediate = new Regex(@"\.f\d+[\w-]*\.\w+$");

    static void DeletePartials(List<string> destinations)
    {
        string downloads = Path.GetFullPath(DownloadsFolder()).TrimEnd('\\') + "\\";
        foreach (string dest in destinations)
        {
            try
            {
                string full = Path.GetFullPath(dest);
                if (!full.StartsWith(downloads, StringComparison.OrdinalIgnoreCase)) continue;
                var targets = new List<string> { full + ".part", full + ".ytdl" };
                if (Intermediate.IsMatch(full)) targets.Add(full);
                // Streamed (HLS/DASH) formats also leave "<file>.part-Frag<n>.part" pieces.
                targets.AddRange(Directory.GetFiles(Path.GetDirectoryName(full), Path.GetFileName(full) + ".part-Frag*"));
                foreach (string t in targets) if (File.Exists(t)) File.Delete(t);
            }
            catch { }
        }
    }

    // The browser login (cookies) for one lookup or download, when the user asked
    // for it. Written to a private temp file for yt-dlp and deleted afterwards.
    static string WriteCookies(string cookies)
    {
        if (string.IsNullOrEmpty(cookies)) return null;
        string path = Path.Combine(Path.GetTempPath(), "miracle-cookies-" + Guid.NewGuid().ToString("N") + ".txt");
        File.WriteAllText(path, cookies, new UTF8Encoding(false));
        return path;
    }

    static void DeleteQuietly(string path)
    {
        try { if (path != null && File.Exists(path)) File.Delete(path); }
        catch { }
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
            // yt-dlp spawns ffmpeg; take the whole tree down. taskkill's output must
            // be captured: our stdout is the browser's message channel.
            var kill = Process.Start(new ProcessStartInfo("taskkill", "/T /F /PID " + p.Id)
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            });
            kill.StandardOutput.ReadToEnd();
            kill.StandardError.ReadToEnd();
            kill.WaitForExit();
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
