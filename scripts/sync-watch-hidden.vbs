' 静默启动 MxPage → GitHub 实时同步守护进程（不弹出控制台窗口）
'
' 用法（手动）：wscript "D:\piliangshengtu\scripts\sync-watch-hidden.vbs"
'
' 开机自启由用户启动文件夹中的 MxPage-GitHub-Sync.vbs 负责，
' 该文件会直接以隐藏方式调用 scripts/sync-watch.mjs 完成常驻。
' 本文件保留供手动静默启动使用。
'
' 本文件只包含 ASCII 字符，避免 Windows 脚本编码问题。

Option Explicit

Dim shell, fso, root, nodeExe, probe
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' scripts\ 的上一级即项目根目录
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

nodeExe = "node.exe"
probe = shell.Run("cmd /c node --version", 0, True)
If probe <> 0 Then
  nodeExe = "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
End If

shell.CurrentDirectory = root
' 0 = 隐藏窗口, False = 不等待返回
shell.Run """" & nodeExe & """ """ & root & "\scripts\sync-watch.mjs""", 0, False
