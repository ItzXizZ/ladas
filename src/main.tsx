const el = document.getElementById('app')!

if (location.pathname === '/render') {
  void import('./RenderPage.tsx').then((m) => m.mountRender(el))
} else {
  void import('./studio/mount.tsx').then((m) => m.mountStudio(el))
}
