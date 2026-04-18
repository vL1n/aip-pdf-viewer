using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Windows.Forms;

static class Program
{
    private const int Port = 13001;
    private const string GitHubRepository = "vL1n/aip-pdf-viewer";
    private const string ReleaseZipName = "AIP-PDF-Viewer-win-x64.zip";
    private const string ChecksumsFileName = "SHA256SUMS.txt";
    private const string LauncherExeName = "aip-launcher.exe";
    private const string UpdaterExeName = "aip-updater.exe";
    private const string UpdatedFromVersionArgName = "--updated-from-version";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private static string AppName => "aip-pdf-viewer";

    private static string ConfigDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);

    private static string ConfigPath => Path.Combine(ConfigDir, "config.json");

    private static string UpdatesDir => Path.Combine(ConfigDir, "updates");

    private static string BaseDir => AppContext.BaseDirectory;

    private static string CurrentVersionText => GetCurrentVersion().Original;

    private static string LatestReleaseApiUrl =>
        $"https://api.github.com/repos/{GitHubRepository}/releases/latest";

    private static string ReleasesPageUrl =>
        $"https://github.com/{GitHubRepository}/releases";

    // 数据目录（exe 同级）
    private static string DataDir => Path.Combine(BaseDir, "data");

    // 索引库：可重建，默认放到 LocalAppData（避免污染安装目录）
    private static string IndexDbPath =>
        Environment.GetEnvironmentVariable("AIP_DB")
        ?? Environment.GetEnvironmentVariable("EAIP_DB")
        ?? Path.Combine(ConfigDir, "index.sqlite");

    // 收藏库：需长期保留，默认放到 exe 同级 ./data/favorites.sqlite（不询问）
    private static string FavoritesDbPath =>
        Environment.GetEnvironmentVariable("AIP_FAV_DB")
        ?? Environment.GetEnvironmentVariable("EAIP_FAV_DB")
        ?? Path.Combine(DataDir, "favorites.sqlite");

    private static string NodeExe => Path.Combine(BaseDir, "node", "node.exe");

    private static string ServerIndexJs => Path.Combine(BaseDir, "server", "dist", "index.js");

    private static string WebDir => Path.Combine(BaseDir, "web");

    private sealed record SemanticVersion(int Major, int Minor, int Patch, string? PreRelease, string Original)
        : IComparable<SemanticVersion>
    {
        public int CompareTo(SemanticVersion? other)
        {
            if (other is null) return 1;

            var major = Major.CompareTo(other.Major);
            if (major != 0) return major;

            var minor = Minor.CompareTo(other.Minor);
            if (minor != 0) return minor;

            var patch = Patch.CompareTo(other.Patch);
            if (patch != 0) return patch;

            var thisStable = string.IsNullOrWhiteSpace(PreRelease);
            var otherStable = string.IsNullOrWhiteSpace(other.PreRelease);
            if (thisStable && otherStable) return 0;
            if (thisStable) return 1;
            if (otherStable) return -1;
            return string.Compare(PreRelease, other.PreRelease, StringComparison.OrdinalIgnoreCase);
        }

        public static SemanticVersion ParseOrDefault(string? rawValue)
        {
            var raw = (rawValue ?? "").Trim();
            var match = Regex.Match(
                raw,
                @"^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<pre>[0-9A-Za-z.-]+))?(?:\+.*)?$",
                RegexOptions.CultureInvariant
            );

            if (!match.Success)
            {
                return new SemanticVersion(0, 0, 0, "dev", "0.0.0-dev");
            }

            return new SemanticVersion(
                int.Parse(match.Groups["major"].Value),
                int.Parse(match.Groups["minor"].Value),
                int.Parse(match.Groups["patch"].Value),
                match.Groups["pre"].Success ? match.Groups["pre"].Value : null,
                raw
            );
        }
    }

    private sealed class ReleaseAsset
    {
        [JsonPropertyName("name")]
        public string Name { get; init; } = "";

        [JsonPropertyName("browser_download_url")]
        public string BrowserDownloadUrl { get; init; } = "";
    }

    private sealed class GitHubRelease
    {
        [JsonPropertyName("tag_name")]
        public string TagName { get; init; } = "";

        [JsonPropertyName("html_url")]
        public string HtmlUrl { get; init; } = "";

        [JsonPropertyName("assets")]
        public List<ReleaseAsset> Assets { get; init; } = [];
    }

    private sealed record ReleasePackage(
        SemanticVersion Version,
        string HtmlUrl,
        string ZipDownloadUrl,
        string ChecksumsDownloadUrl
    );

    private static Dictionary<string, string?> LoadConfig()
    {
        try
        {
            if (!File.Exists(ConfigPath)) return new();
            var text = File.ReadAllText(ConfigPath);
            return JsonSerializer.Deserialize<Dictionary<string, string?>>(text) ?? new();
        }
        catch
        {
            return new();
        }
    }

    private static void SaveConfig(Dictionary<string, string?> cfg)
    {
        Directory.CreateDirectory(ConfigDir);
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(cfg, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static string? GetArgumentValue(string[] args, string name)
    {
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == name && i + 1 < args.Length) return args[i + 1];
        }
        return null;
    }

    private static string? GetRootFromArgs(string[] args) => GetArgumentValue(args, "--root");

    private static string? GetUpdatedFromVersion(string[] args) => GetArgumentValue(args, UpdatedFromVersionArgName);

    private static void ShowCurrentVersionBanner()
    {
        try
        {
            Console.Title = $"AIP PDF Viewer {CurrentVersionText}";
        }
        catch
        {
            // 某些宿主环境不支持设置标题，忽略即可。
        }

        Console.WriteLine($"AIP PDF Viewer 当前版本：{CurrentVersionText}");
    }

    private static void ShowPostUpdateSuccessIfNeeded(string[] args)
    {
        var updatedFromVersion = GetUpdatedFromVersion(args);
        if (string.IsNullOrWhiteSpace(updatedFromVersion))
        {
            return;
        }

        var body = string.Equals(updatedFromVersion, CurrentVersionText, StringComparison.OrdinalIgnoreCase)
            ? $"更新已完成。\n当前版本：{CurrentVersionText}"
            : $"更新已完成。\n{updatedFromVersion} -> {CurrentVersionText}";

        Console.WriteLine(body.Replace('\n', ' '));
        MessageBox.Show(
            body,
            "AIP PDF Viewer 更新",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information
        );
    }

    private static string PromptRoot(string? defaultValue)
    {
        while (true)
        {
            Console.WriteLine("请输入航图 PDF 根目录（例如：D:\\\\Aero\\\\2512eaip）。直接回车使用上次记录：");
            if (!string.IsNullOrWhiteSpace(defaultValue))
                Console.WriteLine($"[默认] {defaultValue}");

            Console.Write("> ");
            var input = Console.ReadLine()?.Trim();
            var chosen = string.IsNullOrWhiteSpace(input) ? defaultValue : input;

            if (string.IsNullOrWhiteSpace(chosen))
            {
                Console.WriteLine("未提供目录。");
                continue;
            }

            if (!Directory.Exists(chosen))
            {
                Console.WriteLine($"目录不存在：{chosen}");
                continue;
            }

            return chosen;
        }
    }

    private static void EnsureBundleOk()
    {
        if (!File.Exists(NodeExe))
            throw new Exception($"缺少 Node：{NodeExe}");
        if (!File.Exists(ServerIndexJs))
            throw new Exception($"缺少后端入口：{ServerIndexJs}");
        if (!Directory.Exists(WebDir))
            throw new Exception($"缺少前端目录：{WebDir}");
    }

    private static SemanticVersion GetCurrentVersion()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var informational =
            assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? assembly.GetName().Version?.ToString()
            ?? "0.0.0-dev";
        return SemanticVersion.ParseOrDefault(informational);
    }

    private static HttpClient CreateGitHubClient()
    {
        var handler = new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
        };
        var client = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(12)
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"aip-launcher/{CurrentVersionText}");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    private static async Task<ReleasePackage?> FetchLatestReleaseAsync()
    {
        using var client = CreateGitHubClient();
        using var response = await client.GetAsync(LatestReleaseApiUrl);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync();
        var payload = await JsonSerializer.DeserializeAsync<GitHubRelease>(stream, JsonOptions);
        if (payload is null) return null;

        var version = SemanticVersion.ParseOrDefault(payload.TagName);
        var zipAsset = payload.Assets.FirstOrDefault(asset =>
            string.Equals(asset.Name, ReleaseZipName, StringComparison.OrdinalIgnoreCase)
        );
        var checksumsAsset = payload.Assets.FirstOrDefault(asset =>
            string.Equals(asset.Name, ChecksumsFileName, StringComparison.OrdinalIgnoreCase)
        );

        if (zipAsset is null || checksumsAsset is null) return null;

        return new ReleasePackage(
            version,
            string.IsNullOrWhiteSpace(payload.HtmlUrl) ? ReleasesPageUrl : payload.HtmlUrl,
            zipAsset.BrowserDownloadUrl,
            checksumsAsset.BrowserDownloadUrl
        );
    }

    private static bool CanWriteToDirectory(string dir)
    {
        try
        {
            Directory.CreateDirectory(dir);
            var probe = Path.Combine(dir, $".write-test-{Guid.NewGuid():N}.tmp");
            File.WriteAllText(probe, "ok");
            File.Delete(probe);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void OpenExternalUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    private static int MapProgress(int start, int end, long current, long total)
    {
        if (end <= start) return start;
        if (total <= 0) return start;

        var ratio = Math.Clamp((double)current / total, 0d, 1d);
        return start + (int)Math.Round((end - start) * ratio);
    }

    private static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        double size = Math.Max(bytes, 0);
        var unitIndex = 0;

        while (size >= 1024 && unitIndex < units.Length - 1)
        {
            size /= 1024;
            unitIndex += 1;
        }

        return $"{size:0.#} {units[unitIndex]}";
    }

    private static async Task DownloadFileAsync(
        HttpClient client,
        string url,
        string targetPath,
        CancellationToken ct,
        Action<long, long?>? onProgress = null
    )
    {
        Directory.CreateDirectory(Path.GetDirectoryName(targetPath) ?? BaseDir);
        var tempPath = $"{targetPath}.tmp";
        if (File.Exists(tempPath)) File.Delete(tempPath);

        using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        await using (var source = await response.Content.ReadAsStreamAsync(ct))
        await using (var target = File.Create(tempPath))
        {
            var buffer = new byte[1024 * 64];
            long totalRead = 0;
            var totalLength = response.Content.Headers.ContentLength;

            while (true)
            {
                var read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length), ct);
                if (read <= 0) break;

                await target.WriteAsync(buffer.AsMemory(0, read), ct);
                totalRead += read;
                onProgress?.Invoke(totalRead, totalLength);
            }
        }

        if (File.Exists(targetPath)) File.Delete(targetPath);
        File.Move(tempPath, targetPath);
    }

    private static async Task<string> ComputeSha256Async(
        string filePath,
        CancellationToken ct,
        Action<long, long>? onProgress = null
    )
    {
        await using var stream = File.OpenRead(filePath);
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[1024 * 64];
        long totalRead = 0;
        var totalLength = stream.Length;

        while (true)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct);
            if (read <= 0) break;

            sha.AppendData(buffer, 0, read);
            totalRead += read;
            onProgress?.Invoke(totalRead, totalLength);
        }

        var hash = sha.GetHashAndReset();
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string ReadExpectedSha256(string checksumsPath, string assetName)
    {
        foreach (var rawLine in File.ReadAllLines(checksumsPath))
        {
            var line = rawLine.Trim();
            if (string.IsNullOrWhiteSpace(line)) continue;

            var match = Regex.Match(
                line,
                @"^(?<hash>[0-9a-fA-F]{64})\s+\*?(?<name>.+)$",
                RegexOptions.CultureInvariant
            );
            if (!match.Success) continue;

            if (string.Equals(match.Groups["name"].Value.Trim(), assetName, StringComparison.OrdinalIgnoreCase))
            {
                return match.Groups["hash"].Value.ToLowerInvariant();
            }
        }

        throw new Exception($"未在 {ChecksumsFileName} 中找到 {assetName} 的 SHA256。");
    }

    private static async Task ExtractZipAsync(
        string zipPath,
        string extractDir,
        CancellationToken ct,
        Action<int, int, string>? onProgress = null
    )
    {
        if (Directory.Exists(extractDir))
        {
            Directory.Delete(extractDir, recursive: true);
        }
        Directory.CreateDirectory(extractDir);

        using var archive = ZipFile.OpenRead(zipPath);
        var entries = archive.Entries.ToList();
        var totalEntries = Math.Max(entries.Count, 1);
        var extractDirFullPath = Path.GetFullPath(extractDir);
        var processed = 0;

        foreach (var entry in entries)
        {
            ct.ThrowIfCancellationRequested();

            var destinationPath = Path.GetFullPath(Path.Combine(extractDirFullPath, entry.FullName));
            var isInsideExtractDir =
                destinationPath.StartsWith(extractDirFullPath + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                || string.Equals(destinationPath, extractDirFullPath, StringComparison.OrdinalIgnoreCase);

            if (!isInsideExtractDir)
            {
                throw new IOException($"更新包包含非法路径：{entry.FullName}");
            }

            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(destinationPath);
            }
            else
            {
                Directory.CreateDirectory(Path.GetDirectoryName(destinationPath) ?? extractDirFullPath);
                await using var source = entry.Open();
                await using var target = File.Create(destinationPath);
                await source.CopyToAsync(target, ct);
            }

            processed += 1;
            onProgress?.Invoke(processed, totalEntries, entry.FullName);
        }
    }

    private static async Task<string> PrepareUpdateBundleAsync(
        ReleasePackage release,
        CancellationToken ct,
        Action<UpdateProgressState>? report
    )
    {
        var versionDir = Path.Combine(UpdatesDir, release.Version.Original.Replace('+', '-'));
        var zipPath = Path.Combine(versionDir, ReleaseZipName);
        var checksumsPath = Path.Combine(versionDir, ChecksumsFileName);
        var extractDir = Path.Combine(versionDir, "bundle");

        if (Directory.Exists(versionDir))
        {
            Directory.Delete(versionDir, recursive: true);
        }
        Directory.CreateDirectory(versionDir);

        using var client = CreateGitHubClient();
        Console.WriteLine($"发现新版本 {release.Version.Original}，开始下载更新包...");
        report?.Invoke(new UpdateProgressState("正在准备更新...", $"目标版本：{release.Version.Original}", 3));

        await DownloadFileAsync(client, release.ZipDownloadUrl, zipPath, ct, (current, total) =>
        {
            var percent = total is > 0 ? MapProgress(5, 55, current, total.Value) : 20;
            var detail = total is > 0
                ? $"{FormatBytes(current)} / {FormatBytes(total.Value)}"
                : $"已下载 {FormatBytes(current)}";
            report?.Invoke(new UpdateProgressState("正在下载更新包...", detail, percent, total is null));
        });

        await DownloadFileAsync(client, release.ChecksumsDownloadUrl, checksumsPath, ct, (current, total) =>
        {
            var percent = total is > 0 ? MapProgress(56, 60, current, total.Value) : 58;
            var detail = total is > 0
                ? $"{ChecksumsFileName} · {FormatBytes(current)} / {FormatBytes(total.Value)}"
                : $"正在下载 {ChecksumsFileName}";
            report?.Invoke(new UpdateProgressState("正在下载校验文件...", detail, percent, total is null));
        });

        var expectedHash = ReadExpectedSha256(checksumsPath, ReleaseZipName);
        var actualHash = await ComputeSha256Async(zipPath, ct, (current, total) =>
        {
            var percent = MapProgress(61, 78, current, total);
            var detail = $"{FormatBytes(current)} / {FormatBytes(total)}";
            report?.Invoke(new UpdateProgressState("正在校验更新包...", detail, percent));
        });
        if (!string.Equals(expectedHash, actualHash, StringComparison.OrdinalIgnoreCase))
        {
            throw new Exception($"更新包校验失败：期望 {expectedHash}，实际 {actualHash}。");
        }

        report?.Invoke(new UpdateProgressState("正在解压更新包...", "准备文件...", 79));
        await ExtractZipAsync(zipPath, extractDir, ct, (current, total, entryName) =>
        {
            var percent = MapProgress(80, 97, current, total);
            var detail = string.IsNullOrWhiteSpace(entryName) ? "正在展开目录结构..." : entryName;
            report?.Invoke(new UpdateProgressState("正在解压更新包...", detail, percent));
        });

        var updaterExe = Path.Combine(extractDir, UpdaterExeName);
        if (!File.Exists(updaterExe))
        {
            throw new Exception($"解压后的更新包缺少 {UpdaterExeName}。");
        }

        report?.Invoke(new UpdateProgressState("正在启动更新器...", "即将完成下载阶段...", 99));
        return extractDir;
    }

    private static ProcessStartInfo BuildUpdaterStartInfo(string extractDir, string[] originalArgs)
    {
        var updaterExe = Path.Combine(extractDir, UpdaterExeName);
        var targetLauncherPath = Path.Combine(BaseDir, LauncherExeName);

        var psi = new ProcessStartInfo
        {
            FileName = updaterExe,
            WorkingDirectory = extractDir,
            UseShellExecute = false,
            CreateNoWindow = false
        };

        psi.ArgumentList.Add("--source");
        psi.ArgumentList.Add(extractDir);
        psi.ArgumentList.Add("--target");
        psi.ArgumentList.Add(BaseDir);
        psi.ArgumentList.Add("--restart");
        psi.ArgumentList.Add(targetLauncherPath);
        psi.ArgumentList.Add("--wait-pid");
        psi.ArgumentList.Add(Environment.ProcessId.ToString());
        psi.ArgumentList.Add("--previous-version");
        psi.ArgumentList.Add(CurrentVersionText);
        psi.ArgumentList.Add("--");

        foreach (var arg in originalArgs)
        {
            psi.ArgumentList.Add(arg);
        }

        return psi;
    }

    private static async Task<bool> TryRunSelfUpdateAsync(string[] args)
    {
        ReleasePackage? release;
        try
        {
            release = await FetchLatestReleaseAsync();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"自动更新检查失败：{ex.Message}");
            return false;
        }

        var currentVersion = GetCurrentVersion();
        if (release is null || release.Version.CompareTo(currentVersion) <= 0)
        {
            return false;
        }

        var promptResult = MessageBox.Show(
            $"检测到新版本 {release.Version.Original}。\n当前版本：{CurrentVersionText}\n\n是否现在更新？",
            "AIP PDF Viewer 更新",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question
        );
        if (promptResult != DialogResult.Yes)
        {
            return false;
        }

        if (!CanWriteToDirectory(BaseDir))
        {
            var openReleaseResult = MessageBox.Show(
                $"检测到新版本 {release.Version.Original}，但当前目录不可写，无法自动替换。\n\n是否打开 GitHub Releases 页面手动下载？",
                "AIP PDF Viewer 更新",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning
            );
            if (openReleaseResult == DialogResult.Yes)
            {
                OpenExternalUrl(release.HtmlUrl);
            }
            return false;
        }

        try
        {
            Directory.CreateDirectory(UpdatesDir);
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
            using var progressDialog = new UpdateProgressDialogController(
                "AIP PDF Viewer 更新",
                "正在准备下载更新..."
            );
            progressDialog.Report(new UpdateProgressState("正在准备下载更新...", $"目标版本：{release.Version.Original}", 1));

            var extractDir = await PrepareUpdateBundleAsync(release, cts.Token, progressDialog.Report);
            progressDialog.Report(new UpdateProgressState("正在切换到安装阶段...", "将启动更新器替换文件", 100));

            var updaterStartInfo = BuildUpdaterStartInfo(extractDir, args);
            var updaterProcess = Process.Start(updaterStartInfo);
            if (updaterProcess is null)
            {
                throw new Exception("无法启动更新器。");
            }

            Console.WriteLine($"已启动更新器，准备更新到 {release.Version.Original}。");
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"自动更新失败：{ex}");
            MessageBox.Show(
                $"自动更新失败，将继续启动当前版本。\n\n{ex.Message}",
                "AIP PDF Viewer 更新",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning
            );
            return false;
        }
    }

    private static async Task WaitHealthAsync(CancellationToken ct)
    {
        using var http = new HttpClient();
        var url = $"http://127.0.0.1:{Port}/api/health";
        var start = DateTime.UtcNow;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var res = await http.GetAsync(url, ct);
                if (res.IsSuccessStatusCode) return;
            }
            catch { }

            if ((DateTime.UtcNow - start).TotalSeconds > 60)
                throw new TimeoutException("等待后端启动超时");

            await Task.Delay(300, ct);
        }
    }

    [STAThread]
    private static async Task Main(string[] args)
    {
        try
        {
            if (await TryRunSelfUpdateAsync(args))
            {
                return;
            }

            ShowCurrentVersionBanner();
            ShowPostUpdateSuccessIfNeeded(args);
            EnsureBundleOk();

            var cfg = LoadConfig();
            var rememberedRoot = cfg.TryGetValue("root", out var v) ? v : null;
            var rootFromArgs = GetRootFromArgs(args);
            var rootFromEnv = Environment.GetEnvironmentVariable("AIP_ROOT");

            // 需求：每次启动都询问航图根目录（除非显式传入 --root 或设置 AIP_ROOT）。
            var root = rootFromArgs ?? rootFromEnv;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
            {
                // 仍然展示上次记录，回车即可复用，但每次都会“询问”
                root = PromptRoot(rememberedRoot);
            }

            cfg["root"] = root;
            SaveConfig(cfg);

            Directory.CreateDirectory(ConfigDir);
            Directory.CreateDirectory(Path.GetDirectoryName(IndexDbPath) ?? ConfigDir);
            Directory.CreateDirectory(Path.GetDirectoryName(FavoritesDbPath) ?? DataDir);

            var serverArgs = new[]
            {
                ServerIndexJs,
                "--root", root,
                "--host", "0.0.0.0",
                "--port", Port.ToString(),
                "--db", IndexDbPath,
                "--fav-db", FavoritesDbPath,
                "--rebuild-db",
                "--serve-web",
                "--web-dist", WebDir
            };

            Console.WriteLine($"启动后端：http://127.0.0.1:{Port}");
            var psi = new ProcessStartInfo
            {
                FileName = NodeExe,
                UseShellExecute = false,
                CreateNoWindow = false,
                WorkingDirectory = Path.Combine(BaseDir, "server"),
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            foreach (var arg in serverArgs) psi.ArgumentList.Add(arg);

            var process = Process.Start(psi) ?? throw new Exception("无法启动后端进程");
            process.OutputDataReceived += (_, e) => { if (e.Data != null) Console.WriteLine(e.Data); };
            process.ErrorDataReceived += (_, e) => { if (e.Data != null) Console.Error.WriteLine(e.Data); };
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            using var cts = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) =>
            {
                e.Cancel = true;
                cts.Cancel();
                try { if (!process.HasExited) process.Kill(true); } catch { }
            };

            await WaitHealthAsync(cts.Token);

            var openUrl = $"http://127.0.0.1:{Port}";
            Console.WriteLine($"打开浏览器：{openUrl}");
            Process.Start(new ProcessStartInfo(openUrl) { UseShellExecute = true });

            await process.WaitForExitAsync(cts.Token);
            Environment.ExitCode = process.ExitCode;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.ToString());
            Environment.ExitCode = 1;
        }
    }
}
