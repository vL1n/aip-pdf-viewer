using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    private const string UpdatedFromVersionArgName = "--updated-from-version";
    private static readonly string[] ManagedEntries =
    {
        "aip-launcher.exe",
        "aip-updater.exe",
        "node",
        "server",
        "web"
    };

    private sealed class UpdateOptions
    {
        public string SourceDir { get; init; } = "";
        public string TargetDir { get; init; } = "";
        public string RestartPath { get; init; } = "";
        public int? WaitPid { get; init; }
        public string? PreviousVersion { get; init; }
        public List<string> RestartArgs { get; init; } = [];
    }

    private static UpdateOptions ParseArgs(string[] args)
    {
        string? sourceDir = null;
        string? targetDir = null;
        string? restartPath = null;
        int? waitPid = null;
        string? previousVersion = null;
        var restartArgs = new List<string>();

        var index = 0;
        for (; index < args.Length; index++)
        {
            if (args[index] == "--")
            {
                index += 1;
                break;
            }

            switch (args[index])
            {
                case "--source" when index + 1 < args.Length:
                    sourceDir = args[++index];
                    break;
                case "--target" when index + 1 < args.Length:
                    targetDir = args[++index];
                    break;
                case "--restart" when index + 1 < args.Length:
                    restartPath = args[++index];
                    break;
                case "--wait-pid" when index + 1 < args.Length && int.TryParse(args[index + 1], out var pid):
                    waitPid = pid;
                    index += 1;
                    break;
                case "--previous-version" when index + 1 < args.Length:
                    previousVersion = args[++index];
                    break;
                default:
                    throw new ArgumentException($"未知参数：{args[index]}");
            }
        }

        for (; index < args.Length; index++)
        {
            restartArgs.Add(args[index]);
        }

        if (string.IsNullOrWhiteSpace(sourceDir)) throw new ArgumentException("缺少 --source");
        if (string.IsNullOrWhiteSpace(targetDir)) throw new ArgumentException("缺少 --target");
        if (string.IsNullOrWhiteSpace(restartPath)) throw new ArgumentException("缺少 --restart");

        return new UpdateOptions
        {
            SourceDir = sourceDir,
            TargetDir = targetDir,
            RestartPath = restartPath,
            WaitPid = waitPid,
            PreviousVersion = previousVersion,
            RestartArgs = restartArgs
        };
    }

    private static bool PathExists(string path) => File.Exists(path) || Directory.Exists(path);

    private static int MapProgress(int start, int end, int current, int total)
    {
        if (end <= start) return start;
        if (total <= 0) return start;

        var ratio = Math.Clamp((double)current / total, 0d, 1d);
        return start + (int)Math.Round((end - start) * ratio);
    }

    private static void RetryIo(Action action, int attempts = 60, int delayMs = 250)
    {
        Exception? lastError = null;
        for (var i = 0; i < attempts; i++)
        {
            try
            {
                action();
                return;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                lastError = ex;
                Thread.Sleep(delayMs);
            }
        }

        throw new IOException("文件系统操作重试后仍失败。", lastError);
    }

    private static void WaitForProcessExit(int? processId)
    {
        if (processId is null) return;

        try
        {
            using var process = Process.GetProcessById(processId.Value);
            process.WaitForExit(30_000);
        }
        catch (ArgumentException)
        {
            // 进程已退出。
        }
    }

    private static void DeletePath(string path)
    {
        if (File.Exists(path))
        {
            RetryIo(() => File.Delete(path));
            return;
        }

        if (Directory.Exists(path))
        {
            RetryIo(() => Directory.Delete(path, recursive: true));
        }
    }

    private static void MovePath(string sourcePath, string destinationPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath) ?? destinationPath);

        if (File.Exists(sourcePath))
        {
            RetryIo(() =>
            {
                if (File.Exists(destinationPath)) File.Delete(destinationPath);
                File.Move(sourcePath, destinationPath);
            });
            return;
        }

        RetryIo(() =>
        {
            if (Directory.Exists(destinationPath)) Directory.Delete(destinationPath, recursive: true);
            Directory.Move(sourcePath, destinationPath);
        });
    }

    private static void CopyDirectory(string sourceDir, string destinationDir)
    {
        Directory.CreateDirectory(destinationDir);

        foreach (var file in Directory.GetFiles(sourceDir))
        {
            var destinationFile = Path.Combine(destinationDir, Path.GetFileName(file));
            RetryIo(() => File.Copy(file, destinationFile, overwrite: true));
        }

        foreach (var directory in Directory.GetDirectories(sourceDir))
        {
            CopyDirectory(directory, Path.Combine(destinationDir, Path.GetFileName(directory)));
        }
    }

    private static void CopyManagedEntry(string sourcePath, string targetPath)
    {
        if (File.Exists(sourcePath))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath) ?? targetPath);
            RetryIo(() => File.Copy(sourcePath, targetPath, overwrite: true));
            return;
        }

        if (Directory.Exists(sourcePath))
        {
            CopyDirectory(sourcePath, targetPath);
            return;
        }

        throw new FileNotFoundException($"更新包中缺少必要内容：{sourcePath}");
    }

    private static void StartLauncher(
        string launcherPath,
        IReadOnlyList<string> launcherArgs,
        string? updatedFromVersion = null
    )
    {
        if (!File.Exists(launcherPath))
        {
            throw new FileNotFoundException($"未找到启动器：{launcherPath}");
        }

        var psi = new ProcessStartInfo
        {
            FileName = launcherPath,
            WorkingDirectory = Path.GetDirectoryName(launcherPath) ?? AppContext.BaseDirectory,
            UseShellExecute = false
        };

        foreach (var arg in launcherArgs)
        {
            psi.ArgumentList.Add(arg);
        }

        if (!string.IsNullOrWhiteSpace(updatedFromVersion))
        {
            psi.ArgumentList.Add(UpdatedFromVersionArgName);
            psi.ArgumentList.Add(updatedFromVersion);
        }

        Process.Start(psi);
    }

    private static void RunUpdate(UpdateOptions options, Action<UpdateProgressState>? report = null)
    {
        if (!Directory.Exists(options.SourceDir))
        {
            throw new DirectoryNotFoundException($"更新源目录不存在：{options.SourceDir}");
        }
        if (!Directory.Exists(options.TargetDir))
        {
            throw new DirectoryNotFoundException($"目标目录不存在：{options.TargetDir}");
        }

        report?.Invoke(new UpdateProgressState("正在等待旧版本退出...", "请不要关闭窗口", 5, options.WaitPid is not null));
        WaitForProcessExit(options.WaitPid);
        report?.Invoke(new UpdateProgressState("正在备份当前文件...", "准备替换受管文件", 10));

        var backupDir = Path.Combine(
            options.TargetDir,
            $".update-backup-{DateTime.UtcNow:yyyyMMddHHmmssfff}"
        );
        Directory.CreateDirectory(backupDir);

        var managedTargets = ManagedEntries
            .Select(entry => new
            {
                Entry = entry,
                TargetPath = Path.Combine(options.TargetDir, entry),
                SourcePath = Path.Combine(options.SourceDir, entry)
            })
            .ToList();
        var existingTargets = managedTargets.Where(item => PathExists(item.TargetPath)).ToList();

        var movedEntries = new List<(string OriginalPath, string BackupPath)>();
        var copiedEntries = new List<string>();

        try
        {
            for (var i = 0; i < existingTargets.Count; i++)
            {
                var item = existingTargets[i];
                var backupPath = Path.Combine(backupDir, item.Entry);
                MovePath(item.TargetPath, backupPath);
                movedEntries.Add((item.TargetPath, backupPath));
                report?.Invoke(new UpdateProgressState(
                    "正在备份当前文件...",
                    item.Entry,
                    MapProgress(10, 40, i + 1, existingTargets.Count)
                ));
            }

            report?.Invoke(new UpdateProgressState("正在写入新版本...", "开始复制更新文件", 45));
            for (var i = 0; i < managedTargets.Count; i++)
            {
                var item = managedTargets[i];
                report?.Invoke(new UpdateProgressState(
                    "正在写入新版本...",
                    item.Entry,
                    MapProgress(45, 90, i, managedTargets.Count)
                ));
                CopyManagedEntry(item.SourcePath, item.TargetPath);
                copiedEntries.Add(item.TargetPath);
                report?.Invoke(new UpdateProgressState(
                    "正在写入新版本...",
                    item.Entry,
                    MapProgress(45, 90, i + 1, managedTargets.Count)
                ));
            }

            report?.Invoke(new UpdateProgressState("正在清理旧版本备份...", "即将完成", 95));
            DeletePath(backupDir);
            report?.Invoke(new UpdateProgressState("正在重启应用...", "将打开新版本", 100));
            StartLauncher(options.RestartPath, options.RestartArgs, options.PreviousVersion);
        }
        catch
        {
            foreach (var copied in copiedEntries.OrderByDescending(path => path.Length))
            {
                try { DeletePath(copied); } catch { }
            }

            foreach (var moved in movedEntries.OrderByDescending(item => item.OriginalPath.Length))
            {
                try
                {
                    if (PathExists(moved.OriginalPath))
                    {
                        DeletePath(moved.OriginalPath);
                    }
                    MovePath(moved.BackupPath, moved.OriginalPath);
                }
                catch { }
            }

            try
            {
                if (Directory.Exists(backupDir) && !Directory.EnumerateFileSystemEntries(backupDir).Any())
                {
                    DeletePath(backupDir);
                }
            }
            catch { }

            throw;
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        UpdateOptions? options = null;
        try
        {
            options = ParseArgs(args);
            using var progressDialog = new UpdateProgressDialogController(
                "AIP PDF Viewer 更新",
                "正在替换应用文件..."
            );
            progressDialog.Report(new UpdateProgressState("正在替换应用文件...", "请稍候...", 1));
            RunUpdate(options, progressDialog.Report);
            return 0;
        }
        catch (Exception ex)
        {
            if (options is not null)
            {
                try
                {
                    MessageBox.Show(
                        $"自动更新失败，将尝试继续启动当前版本。\n\n{ex.Message}",
                        "AIP PDF Viewer 更新",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning
                    );
                    StartLauncher(options.RestartPath, options.RestartArgs);
                    return 1;
                }
                catch (Exception restartError)
                {
                    MessageBox.Show(
                        $"自动更新失败，且恢复旧版本启动失败。\n\n更新错误：{ex.Message}\n\n恢复错误：{restartError.Message}",
                        "AIP PDF Viewer 更新",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return 2;
                }
            }

            MessageBox.Show(
                $"更新器启动失败。\n\n{ex.Message}",
                "AIP PDF Viewer 更新",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return 2;
        }
    }
}
