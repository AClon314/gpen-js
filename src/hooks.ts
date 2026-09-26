import type { Reroute } from "@sveltejs/kit";
import { deLocalizeUrl } from "#lib/paraglide/runtime";

/** 去掉 URL 上的语言前缀后再路由（paraglide）。 */
export const reroute: Reroute = (request) => deLocalizeUrl(request.url).pathname;
