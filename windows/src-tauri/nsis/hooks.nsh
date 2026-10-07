; Uninstall hooks for the NSIS installer.
;
; The app stages coucou-hook.exe into %LOCALAPPDATA%\Coucou\bin at launch, so the
; installer never recorded it and the default uninstaller leaves it behind. The
; inbox and the log live in the same place and are ours too.
;
; Claude Code's own settings.json belongs to the user, so it is never rewritten
; behind their back: an uninstall that is run by hand ASKS first, and only then runs
; `coucou.exe --disconnect`, which takes Coucou's entries out of Windows' and every
; WSL distro's settings.json (a dated backup is kept; other tools' hooks stay). A
; silent uninstall or an update never touches it. A relay that is gone exits 0 without
; printing anything, so a leftover entry costs nothing beyond a dead path.

!macro NSIS_HOOK_PREUNINSTALL
  IfSilent coucou_keep_claude_settings
  IfFileExists "$INSTDIR\coucou.exe" 0 coucou_keep_claude_settings
  MessageBox MB_YESNO|MB_ICONQUESTION "Also remove Coucou from Claude Code's settings (Windows and WSL)?$\n$\nOnly Coucou's own entries are removed, and a dated backup of settings.json is kept." IDNO coucou_keep_claude_settings
  ExecWait '"$INSTDIR\coucou.exe" --disconnect'
  coucou_keep_claude_settings:
  IfSilent coucou_keep_data
  IfFileExists "$INSTDIR\coucou.exe" 0 coucou_keep_data
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete Coucou's settings and the API keys it saved in Windows Credential Manager?" IDNO coucou_keep_data
  ExecWait '"$INSTDIR\coucou.exe" --purge'
  coucou_keep_data:
  ; The coucou:// link that a click on a notification uses.
  DeleteRegKey HKCU "Software\Classes\coucou"
  RMDir /r "$LOCALAPPDATA\Coucou\bin"
  RMDir /r "$LOCALAPPDATA\Coucou\inbox"
  Delete "$LOCALAPPDATA\Coucou\coucou.log"
!macroend
