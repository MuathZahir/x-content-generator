# Generates the penn AI brand icons (speech bubble + X-blue dot on deep
# slate) at 16/32/48/128 px into icons/. Run: pwsh scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$sizes = 16, 32, 48, 128
$outDir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force $outDir | Out-Null

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = $size / 128.0

    # Rounded-square slate backdrop
    $bg = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 28 * $s
    $w = $size - 1
    $bg.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
    $bg.AddArc($w - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $bg.AddArc($w - $r * 2, $w - $r * 2, $r * 2, $r * 2, 0, 90)
    $bg.AddArc(0, $w - $r * 2, $r * 2, $r * 2, 90, 90)
    $bg.CloseFigure()

    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($size, $size)),
        [System.Drawing.Color]::FromArgb(255, 21, 32, 43),
        [System.Drawing.Color]::FromArgb(255, 10, 16, 23))
    $g.FillPath($bgBrush, $bg)

    if ($size -ge 32) {
        $border = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 47, 68, 83), [Math]::Max(1, 2 * $s))
        $g.DrawPath($border, $bg)
        $border.Dispose()
    }

    # Speech-bubble outline (the reply), drawn as a rounded rect + tail
    $bubble = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bx = 24 * $s; $by = 30 * $s; $bw = 80 * $s; $bh = 52 * $s; $br = 16 * $s
    $bubble.AddArc($bx, $by, $br * 2, $br * 2, 180, 90)
    $bubble.AddArc($bx + $bw - $br * 2, $by, $br * 2, $br * 2, 270, 90)
    $bubble.AddArc($bx + $bw - $br * 2, $by + $bh - $br * 2, $br * 2, $br * 2, 0, 90)
    # tail
    $bubble.AddLine($bx + 44 * $s, $by + $bh, $bx + 24 * $s, $by + $bh + 18 * $s)
    $bubble.AddLine($bx + 24 * $s, $by + $bh + 18 * $s, $bx + 26 * $s, $by + $bh)
    $bubble.AddArc($bx, $by + $bh - $br * 2, $br * 2, $br * 2, 90, 90)
    $bubble.CloseFigure()

    $bubblePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 231, 233, 234), [Math]::Max(1.4, 7 * $s))
    $bubblePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($bubblePen, $bubble)
    $bubblePen.Dispose()

    # X-blue dot inside the bubble (the brand dot), with a soft halo
    $cx = $bx + $bw / 2; $cy = $by + $bh / 2; $dotR = 11 * $s
    if ($size -ge 48) {
        $halo = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 29, 155, 240))
        $g.FillEllipse($halo, $cx - $dotR * 2, $cy - $dotR * 2, $dotR * 4, $dotR * 4)
        $halo.Dispose()
    }
    $dot = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 29, 155, 240))
    $g.FillEllipse($dot, $cx - $dotR, $cy - $dotR, $dotR * 2, $dotR * 2)
    $dot.Dispose()

    $g.Dispose()
    $path = Join-Path $outDir "icon$size.png"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "wrote $path"
}
