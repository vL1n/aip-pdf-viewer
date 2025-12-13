using System.Diagnostics;
using System.Text.Json;

static class Program
{
    private const int Port = 13001;

    private static string AppName => "aip-pdf-viewer";

    private static string ConfigDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);

    private static string ConfigPath => Path.Combine(ConfigDir, "config.json");

    private static string BaseDir => AppContext.BaseDirectory;

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

    private static string? GetRootFromArgs(string[] args)
    {
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--root" && i + 1 < args.Length) return args[i + 1];
        }
        return null;
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

    private static async Task Main(string[] args)
    {
        try
        {
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

            // 直接重建索引库（与你当前默认行为一致）
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
            foreach (var a in serverArgs) psi.ArgumentList.Add(a);

            var p = Process.Start(psi) ?? throw new Exception("无法启动后端进程");
            p.OutputDataReceived += (_, e) => { if (e.Data != null) Console.WriteLine(e.Data); };
            p.ErrorDataReceived += (_, e) => { if (e.Data != null) Console.Error.WriteLine(e.Data); };
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();

            using var cts = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) =>
            {
                e.Cancel = true;
                cts.Cancel();
                try { if (!p.HasExited) p.Kill(true); } catch { }
            };

            await WaitHealthAsync(cts.Token);

            // 打开浏览器（局域网可访问）
            var openUrl = $"http://127.0.0.1:{Port}";
            Console.WriteLine($"打开浏览器：{openUrl}");
            Process.Start(new ProcessStartInfo(openUrl) { UseShellExecute = true });

            await p.WaitForExitAsync(cts.Token);
            Environment.ExitCode = p.ExitCode;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.ToString());
            Environment.ExitCode = 1;
        }
    }
}


