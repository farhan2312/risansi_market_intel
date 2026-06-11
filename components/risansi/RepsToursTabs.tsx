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

  const pillStyle = (value: string): CSSProperties => ({
    fontSize: 13,
    fontWeight: 600,
    padding: '6px 16px',
    borderRadius: 16,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    background: currentTab === value ? '#0A3D8F' : 'transparent',
    color: currentTab === value ? 'white' : 'var(--fg-3)',
    boxShadow: 'none',
  });

  return (
    <Tabs
      value={currentTab}
      onValueChange={handleTabChange}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <TabsList
        style={{
          width: 'fit-content',
          marginBottom: 16,
          background: 'var(--bg-elev)',
          borderRadius: 20,
          padding: 3,
          border: 'none',
          boxShadow: 'none',
        }}
      >
        <TabsTrigger value="reps" style={pillStyle('reps')}>
          Reps ({repsCount})
        </TabsTrigger>
        <TabsTrigger value="tours" style={pillStyle('tours')}>
          Tours ({toursCount})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="reps" style={{ marginTop: 0 }}>
        {repsContent}
      </TabsContent>

      <TabsContent value="tours" style={{ marginTop: 0 }}>
        {toursContent}
      </TabsContent>
    </Tabs>
  );
}
