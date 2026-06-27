; 安装后：修复文件关联图标、添加右键"新建"菜单、清理旧重复项
!macro NSIS_HOOK_POSTINSTALL
  ; 仅 .md 注册 ShellNew（右键"新建"菜单）
  WriteRegStr HKCU "Software\Classes\.md\ShellNew" "NullFile" ""

  ; 清理旧版可能残留的 .markdown ShellNew，避免两个重复项
  DeleteRegKey HKCU "Software\Classes\.markdown\ShellNew"

  ; DefaultIcon 追加 ",0" 显式指定图标索引
  ReadRegStr $0 HKCU "Software\Classes\solo.markdown\DefaultIcon" ""
  StrCmp $0 "" +2
  WriteRegStr HKCU "Software\Classes\solo.markdown\DefaultIcon" "" "$0,0"

  ; 通知 Explorer 刷新，立即生效
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

; 卸载后：清理 solo 注册的 ShellNew、DefaultIcon
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\.md\ShellNew"
  DeleteRegKey HKCU "Software\Classes\.markdown\ShellNew"
!macroend
