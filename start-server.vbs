nodeExe = "node"
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "bye" Then
    On Error Resume Next
    Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    x.setTimeouts 2000, 2000, 15000, 15000
    x.open "POST", "http://127.0.0.1:8000/bye", False
    x.setRequestHeader "X-Radio", "1"
    x.send ""
    WScript.Quit 0
  End If
End If
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
On Error Resume Next
sysPath = sh.RegRead("HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path")
usrPath = sh.RegRead("HKCU\Environment\Path")
On Error GoTo 0
Set env = sh.Environment("Process")
env("PATH") = sh.ExpandEnvironmentStrings(sysPath & ";" & usrPath) & ";" & env("PATH")
cmd = nodeExe
If InStr(nodeExe, " ") > 0 Then cmd = Chr(34) & nodeExe & Chr(34)
extra = ""
On Error Resume Next
sh.Run cmd & " server.js --auto" & extra, 0, False
If Err.Number <> 0 Then
  MsgBox "node.exe not found. Open start-server.vbs in Notepad and set nodeExe to the full path of node.exe. To find it, run in PowerShell: (Get-Command node).Source", 16, "start-server"
End If
