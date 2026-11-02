/* 页面注册表：路由名 → 渲染函数 */

import * as resources from './resources.js';
import * as circles from './circles.js';
import * as posts from './posts.js';
import * as account from './account.js';
import * as misc from './misc.js';
import { growth } from './growth.js';

export default {
  resourcesHome: resources.resources,
  resources: resources.resourceSearch,
  resource: resources.resourceDetail,
  resourcePublish: resources.resourcePublish,

  circles: circles.circles,
  circle: circles.circle,
  findCircles: circles.findCircles,
  invite: circles.invite,

  post: posts.post,
  postEdit: posts.postEdit,
  compose: posts.compose,

  login: account.login,
  profile: account.profile,
  saved: account.saved,
  messages: account.messages,
  wallet: account.wallet,
  growth: growth,
  settings: account.settings,

  course: misc.course,
  search: misc.search,
  admin: misc.admin,
  about: misc.about,
  notFound: misc.notFound
};


