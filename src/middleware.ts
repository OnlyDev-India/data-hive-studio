import { NextResponse, NextRequest } from "next/server";

// const protectedRoutes = sideBadMenu.filter((item) => item.link).map((item) => item.link);
const publicRoutes = ["/"]

// This function can be marked `async` if using `await` inside
export async function middleware(request: NextRequest) {
  try {
    const connectionDetails = request.cookies.get("currentConnection")?.value;
    const pathname = request.nextUrl.pathname;
    if (connectionDetails && publicRoutes.includes(pathname)) {
      return NextResponse.redirect(new URL("/app/editor", request.url));
    }
    // if connectionDetails is not present and the pathname is not in the publicRoutes, then redirect to the home page
    if (!connectionDetails && !publicRoutes.includes(pathname)) {
      const response= NextResponse.redirect(new URL("/", request.url));
      response.cookies.delete("currentConnection");
      response.cookies.delete("dbType");
      return response;
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
