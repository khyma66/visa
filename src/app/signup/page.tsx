import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';
export const metadata: Metadata = { title: 'Create Account' };
export default function SignupPage() { return <AuthForm signup />; }
