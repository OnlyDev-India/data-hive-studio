import { NextResponse, NextRequest } from "next/server";
import { sideBadMenu } from "./config/menu";

const protectedRoutes = sideBadMenu.filter((item) => item.link).map((item) => item.link);

// This function can be marked `async` if using `await` inside
export async function middleware(request: NextRequest) {
  try {
    const connectionDetails = request.cookies.get("currentConnection")?.value;
    const pathname = request.nextUrl.pathname;
    if (connectionDetails && !protectedRoutes.includes(pathname)) {
      return NextResponse.redirect(new URL("/app/editor", request.url));
    }
    if (pathname !== "/") {
      const response= NextResponse.redirect(new URL("/", request.url));
      response.cookies.delete("currentConnection");
      response.cookies.delete("dbType");
    }
    return NextResponse.next();
  } catch (e) {
    console.log(e);

    return NextResponse.redirect(new URL("/", request.url));
  }
}

export const config = {
  matcher: ["/", "/app/:path*"],
};
