'use client';

interface PageSkeletonProps {
  title?: string;
}

export default function PageSkeleton({ title = '載入中' }: PageSkeletonProps) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-3">
          <div className="h-8 w-40 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-64 animate-pulse rounded bg-gray-200" />
          <span className="sr-only">{title}</span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 h-5 w-24 animate-pulse rounded bg-gray-200" />
              <div className="h-8 w-20 animate-pulse rounded bg-gray-200" />
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 h-5 w-32 animate-pulse rounded bg-gray-200" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
