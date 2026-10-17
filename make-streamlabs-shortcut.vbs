Option Explicit

Dim fso, sh, here, cands, args
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName) & "\"
Set cands = CreateObject("Scripting.Dictionary")
cands.CompareMode = 1
Set args = WScript.Arguments

Function Env(s)
  Env = sh.ExpandEnvironmentStrings(s)
End Function

Function Bad(n)
  Dim w
  Bad = True
  If LCase(Right(n, 4)) <> ".exe" Then Exit Function
  For Each w In Array("uninst", "update", "crash", "helper", "elevate", "setup", "chatbot", "cloudbot", "plugin", "ffmpeg")
    If InStr(LCase(n), w) > 0 Then Exit Function
  Next
  Bad = False
End Function

Sub Add(ByVal p, ByVal bonus)
  Dim n, s
  On Error Resume Next
  p = Trim(Replace(Replace("" & p, """", ""), "/", "\"))
  If InStrRev(p, ",") > InStrRev(p, "\") And InStrRev(p, "\") > 0 Then p = Left(p, InStrRev(p, ",") - 1)
  If p = "" Then Exit Sub
  If Not fso.FileExists(p) Then Exit Sub
  n = fso.GetFileName(p)
  If Bad(n) Then Exit Sub
  n = LCase(n)
  s = bonus + fso.GetFile(p).Size / 1000000000
  If InStr(n, "streamlabs") > 0 Then s = s + 2
  If InStr(n, "desktop") > 0 Or InStr(n, "obs") > 0 Then s = s + 3
  If Not cands.Exists(p) Then
    cands.Add p, s
  ElseIf cands(p) < s Then
    cands(p) = s
  End If
End Sub

Sub ScanDir(ByVal d, ByVal depth, ByVal bonus)
  Dim f, sf
  On Error Resume Next
  If Not fso.FolderExists(d) Then Exit Sub
  For Each f In fso.GetFolder(d).Files
    Add f.Path, bonus
  Next
  If depth > 0 Then
    For Each sf In fso.GetFolder(d).SubFolders
      ScanDir sf.Path, depth - 1, bonus
    Next
  End If
End Sub

Sub ScanLnk(ByVal d, ByVal depth)
  Dim f, sf
  On Error Resume Next
  If Not fso.FolderExists(d) Then Exit Sub
  For Each f In fso.GetFolder(d).Files
    If LCase(Right(f.Name, 4)) = ".lnk" And InStr(LCase(f.Name), "streamlabs") > 0 Then Add sh.CreateShortcut(f.Path).TargetPath, 5
  Next
  If depth > 0 Then
    For Each sf In fso.GetFolder(d).SubFolders
      ScanLnk sf.Path, depth - 1
    Next
  End If
End Sub

Sub ScanProcs()
  Dim w, ps, p
  On Error Resume Next
  Set w = GetObject("winmgmts:\\.\root\cimv2")
  Set ps = w.ExecQuery("SELECT ExecutablePath FROM Win32_Process WHERE Name LIKE '%streamlabs%'")
  For Each p In ps
    Add p.ExecutablePath, 6
  Next
End Sub

Sub ScanUninstall(ByVal hive, ByVal path)
  Dim reg, keys, k, nm, v
  On Error Resume Next
  Set reg = GetObject("winmgmts:root\default:StdRegProv")
  If reg.EnumKey(hive, path, keys) <> 0 Then Exit Sub
  For Each k In keys
    nm = ""
    reg.GetStringValue hive, path & "\" & k, "DisplayName", nm
    nm = "" & nm
    If InStr(LCase(nm & "|" & k), "streamlabs") > 0 Then
      v = ""
      reg.GetStringValue hive, path & "\" & k, "DisplayIcon", v
      Add "" & v, 5
      v = ""
      reg.GetStringValue hive, path & "\" & k, "InstallLocation", v
      v = "" & v
      If v <> "" Then ScanDir v, 1, 4
    End If
  Next
End Sub

Sub ScanRoot(ByVal r)
  Dim sf
  On Error Resume Next
  If Not fso.FolderExists(r) Then Exit Sub
  For Each sf In fso.GetFolder(r).SubFolders
    If InStr(LCase(sf.Name), "streamlabs") > 0 Then ScanDir sf.Path, 2, 2
  Next
End Sub

Function FindStreamlabs()
  Dim k, best, bs, r, dr
  cands.RemoveAll
  ScanProcs
  ScanUninstall &H80000002, "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
  ScanUninstall &H80000002, "SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  ScanUninstall &H80000001, "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
  ScanLnk Env("%ProgramData%") & "\Microsoft\Windows\Start Menu\Programs", 1
  ScanLnk Env("%AppData%") & "\Microsoft\Windows\Start Menu\Programs", 1
  For Each r In Array(Env("%ProgramFiles%"), Env("%ProgramFiles(x86)%"), Env("%ProgramW6432%"), Env("%LocalAppData%"), Env("%LocalAppData%") & "\Programs", Env("%AppData%"))
    ScanRoot r
  Next
  On Error Resume Next
  For Each dr In fso.Drives
    If dr.DriveType = 2 Then
      ScanRoot dr.Path & "\"
      ScanRoot dr.Path & "\Program Files"
      ScanRoot dr.Path & "\Program Files (x86)"
    End If
  Next
  On Error GoTo 0
  best = ""
  bs = -1
  For Each k In cands.Keys
    If cands(k) > bs Then
      bs = cands(k)
      best = k
    End If
  Next
  FindStreamlabs = best
End Function

Dim exe, lnk, lnkPath

If args.Count > 0 Then
  If LCase(args(0)) = "run" Then
    exe = ""
    If args.Count > 1 Then
      If fso.FileExists(args(1)) Then exe = args(1)
    End If
    If exe = "" Then exe = FindStreamlabs()
    sh.Run "wscript.exe """ & here & "start-server.vbs""", 0, False
    If exe = "" Then
      MsgBox "Streamlabs не найден. Сервер запущен. Запусти make-streamlabs-shortcut.vbs ещё раз, чтобы пересоздать ярлык.", 48, "Запуск Streamlabs"
    Else
      sh.CurrentDirectory = fso.GetParentFolderName(exe)
      sh.Run """" & exe & """", 1, False
    End If
    WScript.Quit 0
  End If
End If

exe = FindStreamlabs()
If exe = "" Then
  exe = InputBox("Streamlabs не найден автоматически. Вставь полный путь к его .exe:", "Запуск Streamlabs", "")
  exe = Trim(Replace(Replace(exe, """", ""), "/", "\"))
End If
If exe = "" Or Not fso.FileExists(exe) Then
  MsgBox "Исполняемый файл Streamlabs не найден. Ярлык не создан.", 16, "Запуск Streamlabs"
  WScript.Quit 1
End If

lnkPath = here & "Streamlabs (с сервером).lnk"
Set lnk = sh.CreateShortcut(lnkPath)
lnk.TargetPath = Env("%SystemRoot%\System32\wscript.exe")
lnk.Arguments = """" & WScript.ScriptFullName & """ run """ & exe & """"
lnk.WorkingDirectory = here
lnk.IconLocation = exe & ",0"
lnk.WindowStyle = 1
lnk.Description = "Запускает сервер заказов за баллы, затем Streamlabs"
lnk.Save

MsgBox "Streamlabs найден:" & vbCrLf & exe & vbCrLf & vbCrLf & "Ярлык создан:" & vbCrLf & lnkPath, 64, "Запуск Streamlabs"