import type { Handle } from "@sveltejs/kit";
import { getTextDirection } from "#lib/paraglide/runtime";
import { paraglideMiddleware } from "#lib/paraglide/server";

const handleParaglide: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;

    return resolve(event, {
      transformPageChunk: ({ html }) =>
        html
          .replace("%paraglide.lang%", locale)
          .replace("%paraglide.dir%", getTextDirection(locale)),
    });
  });

/** 服务端挂上 paraglide 的请求处理与语言属性注入。 */
export const handle: Handle = handleParaglide;
