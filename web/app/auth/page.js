import AuthClient from "./AuthClient";

export const metadata = {
  title: "Sign in or create your lookout",
};

// The tab is resolved on the server so /auth?mode=register renders the
// create-account view directly, with no login-tab flash.
export default async function AuthPage({ searchParams }) {
  const params = await searchParams;
  const initialTab = params?.mode === "register" ? "register" : "login";
  return <AuthClient initialTab={initialTab} />;
}
