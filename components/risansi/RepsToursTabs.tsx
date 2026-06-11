'use client';

import { type CSSProperties, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface Props {
  repsCount: number;
  toursCount: number;
  repsContent: ReactNode;
  toursContent: ReactNode;
}

export function RepsToursTabs({ repsCount, toursCount, repsContent, toursContent }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') === 'tours' ? 'tours' : 'reps';

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={currentTab} onValueChange={handleTabChange} className="">
      <TabsList variant="line" style={{ gap: 0, marginBottom: 16 }}>
        <TabsTrigger value="reps" style={TAB_TRIGGER}>
          Reps ({repsCount})
        </TabsTrigger>
        <TabsTrigger value="tours" style={TAB_TRIGGER}>
          Tours ({toursCount})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="reps">
        {repsContent}
      </TabsContent>

      <TabsContent value="tours">
        {toursContent}
      </TabsContent>
    </Tabs>
  );
}

const TAB_TRIGGER: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 16px',
  fontFamily: 'inherit',
};
