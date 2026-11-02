/* 共页静态站运行配置
 * 本文件不参与构建，可直接在服务器上编辑后再刷新页面，无需重新打包。
 * detail 见 DEPLOY_HANDOFF.md「运行时配置」一节。
 */
window.__GONGYE_CONFIG__ = {
  // demo-static：纯静态演示模式。全部数据保存在访问者浏览器本地。
  // production：走真实后端（server/ 里的内部试用后端；需要 Node 进程运行）。
  mode: 'demo-static',
  // 生产模式下填写后端地址，例如 https://api.example.com
  apiBase: '',
  storageKey: 'gongye-demo-v1',
  // 站点根路径；部署到子目录时改成 '/gongye/'，并在 index.html 改 <base href>。
  basePath: '/',
  // 文化主题开关：false 时 4 个文化日期改用 neutral 插画（见 daily-bookmarks.js）
  culturalThemes: true,
  demoNotice: '静态演示版：内容与账号均为演示数据，数据保存在本机浏览器，不会上传服务器。'
};
