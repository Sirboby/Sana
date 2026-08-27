import { EmailCodeForm } from '@/components/auth/EmailCodeForm';

/** Sign in (US-1.1). Same flow as /signup — see AC-1.1.7. */
export default function LoginPage() {
  return <EmailCodeForm heading="Sign in to Sana" />;
}
