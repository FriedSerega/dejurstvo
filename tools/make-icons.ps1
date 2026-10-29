# Генерация иконок расширения: синий квадрат, белый календарь, оранжевая точка.
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function New-RoundedPath([double]$x, [double]$y, [double]$w, [double]$h, [double]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  if ($d -le 0) { $d = 0.1 }
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

foreach ($size in @(16, 32, 48, 128)) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $blue = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 133, 242))
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $orange = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 232, 89, 12))

  $s = [double]$size

  # фон
  $bgPath = New-RoundedPath 0 0 $s $s ($s * 0.22)
  $g.FillPath($blue, $bgPath)

  # «кольца» календаря
  $ringW = [Math]::Max(1.0, $s * 0.06)
  $ringY = $s * 0.17
  $ringH = [Math]::Max(1.5, $s * 0.14)
  $g.FillRectangle($white, [single]($s * 0.34), [single]$ringY, [single]$ringW, [single]$ringH)
  $g.FillRectangle($white, [single]($s * 0.60), [single]$ringY, [single]$ringW, [single]$ringH)

  # корпус календаря
  $body = New-RoundedPath ($s * 0.20) ($s * 0.27) ($s * 0.60) ($s * 0.54) ($s * 0.10)
  $g.FillPath($white, $body)

  # точка дежурства
  $dot = [Math]::Max(1.5, $s * 0.16)
  $g.FillEllipse($orange, [single]($s * 0.52), [single]($s * 0.54), [single]$dot, [single]$dot)

  $file = Join-Path $out ("icon{0}.png" -f $size)
  $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)

  $g.Dispose()
  $bitmap.Dispose()
  $blue.Dispose()
  $white.Dispose()
  $orange.Dispose()
}

Write-Output "Иконки готовы: $out"
