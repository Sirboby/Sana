import { EmailCodeForm } from '@/components/auth/EmailCodeForm';

/**
 * Signup (US-1.1). Identical flow to /login by design — AC-1.1.7 makes signup
 * and sign-in one path, so an existing address here simply signs in.
 */
export default function SignupPage() {
  return <EmailCodeForm heading="Create your Sana account" />;
}
