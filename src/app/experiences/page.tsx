import type { Metadata } from 'next';
import { CommunityHome } from '@/components/CommunityHome';
export const metadata: Metadata = { title: 'U.S. Visa Experiences' };
export default function ExperiencesPage() { return <CommunityHome key="experiences" experience />; }
