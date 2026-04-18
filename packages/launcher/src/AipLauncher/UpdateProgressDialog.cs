using System.Drawing;
using System.Threading;
using System.Windows.Forms;

internal sealed record UpdateProgressState(string Message, string Detail = "", int? Percent = null, bool Indeterminate = false);

internal sealed class UpdateProgressDialogController : IDisposable
{
    private readonly ManualResetEventSlim _ready = new(false);
    private readonly Thread _uiThread;
    private UpdateProgressWindow? _window;
    private Exception? _startupError;

    public UpdateProgressDialogController(string title, string initialMessage)
    {
        _uiThread = new Thread(() =>
        {
            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                var window = new UpdateProgressWindow(title, initialMessage);
                _window = window;
                window.Shown += (_, _) => _ready.Set();
                Application.Run(window);
            }
            catch (Exception ex)
            {
                _startupError = ex;
                _ready.Set();
            }
        });

        _uiThread.IsBackground = true;
        _uiThread.SetApartmentState(ApartmentState.STA);
        _uiThread.Start();

        if (!_ready.Wait(TimeSpan.FromSeconds(5)))
        {
            throw new TimeoutException("更新进度窗口启动超时。");
        }

        if (_startupError is not null)
        {
            throw new InvalidOperationException("无法显示更新进度窗口。", _startupError);
        }
    }

    public void Report(UpdateProgressState state)
    {
        var window = _window;
        if (window is null || window.IsDisposed || !window.IsHandleCreated) return;

        try
        {
            window.BeginInvoke(new Action(() => window.Apply(state)));
        }
        catch
        {
            // 进度窗口已关闭时忽略更新。
        }
    }

    public void Dispose()
    {
        var window = _window;
        if (window is not null && !window.IsDisposed && window.IsHandleCreated)
        {
            try
            {
                window.BeginInvoke(new Action(window.Close));
            }
            catch
            {
                // 忽略关闭过程中的竞态。
            }
        }

        if (_uiThread.IsAlive)
        {
            _uiThread.Join(3000);
        }

        _ready.Dispose();
    }
}

internal sealed class UpdateProgressWindow : Form
{
    private readonly Label _messageLabel;
    private readonly Label _detailLabel;
    private readonly Label _percentLabel;
    private readonly ProgressBar _progressBar;

    public UpdateProgressWindow(string title, string initialMessage)
    {
        Text = title;
        Width = 460;
        Height = 170;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ControlBox = false;
        TopMost = true;

        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(18),
            ColumnCount = 1,
            RowCount = 4
        };
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        _messageLabel = new Label
        {
            AutoSize = true,
            Font = new Font(SystemFonts.MessageBoxFont, FontStyle.Bold),
            Text = initialMessage,
            Dock = DockStyle.Top
        };

        _detailLabel = new Label
        {
            AutoSize = true,
            ForeColor = SystemColors.GrayText,
            Text = "请稍候...",
            Dock = DockStyle.Top,
            Padding = new Padding(0, 6, 0, 10)
        };

        var progressPanel = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            ColumnCount = 2,
            RowCount = 1
        };
        progressPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        progressPanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        _progressBar = new ProgressBar
        {
            Dock = DockStyle.Fill,
            Height = 22,
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 30
        };

        _percentLabel = new Label
        {
            AutoSize = true,
            Text = "",
            TextAlign = ContentAlignment.MiddleRight,
            Dock = DockStyle.Fill,
            Padding = new Padding(12, 3, 0, 0)
        };

        progressPanel.Controls.Add(_progressBar, 0, 0);
        progressPanel.Controls.Add(_percentLabel, 1, 0);

        panel.Controls.Add(_messageLabel, 0, 0);
        panel.Controls.Add(_detailLabel, 0, 1);
        panel.Controls.Add(progressPanel, 0, 2);

        Controls.Add(panel);
    }

    public void Apply(UpdateProgressState state)
    {
        _messageLabel.Text = state.Message;
        _detailLabel.Text = string.IsNullOrWhiteSpace(state.Detail) ? "请稍候..." : state.Detail;

        if (state.Indeterminate || state.Percent is null)
        {
            if (_progressBar.Style != ProgressBarStyle.Marquee)
            {
                _progressBar.Style = ProgressBarStyle.Marquee;
                _progressBar.MarqueeAnimationSpeed = 30;
            }
            _percentLabel.Text = "";
            return;
        }

        var clamped = Math.Clamp(state.Percent.Value, 0, 100);
        if (_progressBar.Style != ProgressBarStyle.Continuous)
        {
            _progressBar.Style = ProgressBarStyle.Continuous;
            _progressBar.MarqueeAnimationSpeed = 0;
        }
        _progressBar.Value = clamped;
        _percentLabel.Text = $"{clamped}%";
    }
}
