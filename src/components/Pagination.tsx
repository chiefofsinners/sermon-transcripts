export default function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-4 pt-2 sm:pt-4">
      <button
        onClick={() => onPageChange(1)}
        disabled={page <= 1}
        className="px-3 py-2 text-base sm:px-2.5 sm:py-1.5 sm:text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600
                   enabled:hover:bg-gray-300 dark:enabled:hover:bg-gray-800 enabled:cursor-pointer
                   disabled:opacity-40 disabled:cursor-default
                   text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-900 transition-colors"
        aria-label="First page"
        title="First page"
      >
        ⟨⟨
      </button>
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="px-3.5 py-2 text-base sm:px-3 sm:py-1.5 sm:text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600
                   enabled:hover:bg-gray-300 dark:enabled:hover:bg-gray-800 enabled:cursor-pointer
                   disabled:opacity-40 disabled:cursor-default
                   text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-900 transition-colors"
      >
        <span className="hidden sm:inline">Previous</span>
        <span className="sm:hidden">&lsaquo;</span>
      </button>
      <span className="text-base sm:text-sm text-gray-500 dark:text-gray-400">
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="px-3.5 py-2 text-base sm:px-3 sm:py-1.5 sm:text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600
                   enabled:hover:bg-gray-300 dark:enabled:hover:bg-gray-800 enabled:cursor-pointer
                   disabled:opacity-40 disabled:cursor-default
                   text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-900 transition-colors"
      >
        <span className="hidden sm:inline">Next</span>
        <span className="sm:hidden">&rsaquo;</span>
      </button>
      <button
        onClick={() => onPageChange(totalPages)}
        disabled={page >= totalPages}
        className="px-3 py-2 text-base sm:px-2.5 sm:py-1.5 sm:text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600
                   enabled:hover:bg-gray-300 dark:enabled:hover:bg-gray-800 enabled:cursor-pointer
                   disabled:opacity-40 disabled:cursor-default
                   text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-900 transition-colors"
        aria-label="Last page"
        title="Last page"
      >
        ⟩⟩
      </button>
    </div>
  );
}
