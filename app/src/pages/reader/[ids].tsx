import { useRouter } from 'next/router';
import { AuthProvider } from '@/context/AuthContext';
import { EnvProvider } from '@/context/EnvContext';
import { CSPostHogProvider } from '@/context/PHContext';
import Reader from '@/app/reader/components/Reader';

export default function Page() {
  const router = useRouter();
  const ids = router.query['ids'] as string;
  return (
    <CSPostHogProvider>
      <EnvProvider>
        <AuthProvider>
          <Reader ids={ids} />
        </AuthProvider>
      </EnvProvider>
    </CSPostHogProvider>
  );
}
