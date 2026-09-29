import { Amplify } from 'aws-amplify';
import { fetchAuthSession, getCurrentUser, signInWithRedirect, signOut } from 'aws-amplify/auth';
import 'aws-amplify/auth/enable-oauth-listener';

const env = import.meta.env;
const userPoolId = env.VITE_COGNITO_USER_POOL_ID?.trim();
const clientId = env.VITE_COGNITO_CLIENT_ID?.trim();
const domain = env.VITE_COGNITO_DOMAIN?.trim()?.replace(/^https?:\/\//, '').replace(/\/$/, '');
const appUrl = env.VITE_APP_URL?.trim() || `${window.location.origin}/`;

export const localMock = env.DEV && env.VITE_DEV_MOCK_AUTH === 'true';
export const authConfigured = Boolean(userPoolId && clientId && domain);

if (authConfigured) {
  Amplify.configure({ Auth: { Cognito: { userPoolId, userPoolClientId: clientId, loginWith: { oauth: { domain, scopes: ['openid', 'email', 'profile'], redirectSignIn: [appUrl], redirectSignOut: [appUrl], responseType: 'code', providers: ['Google'] } } } } });
}

export async function isSignedIn(): Promise<boolean> {
  if (localMock) return true;
  if (!authConfigured) return false;
  try { await getCurrentUser(); return true; } catch { return false; }
}

export async function login() {
  if (!authConfigured) throw new Error('Cognito is not configured. Add the user pool settings to .env.');
  await signInWithRedirect({ provider: 'Google' });
}

export async function logout() {
  if (localMock) return;
  await signOut();
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (localMock) headers.set('x-dev-user-sub', env.VITE_DEV_USER_SUB || 'dev_admin');
  else {
    const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function downloadReport(path: string): Promise<void> {
  const headers = new Headers();
  if (localMock) headers.set('x-dev-user-sub', env.VITE_DEV_USER_SUB || 'dev_admin');
  else {
    const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(`/api${path}`, { headers });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Download failed');
  const disposition = response.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || 'karunodaya-report';
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
