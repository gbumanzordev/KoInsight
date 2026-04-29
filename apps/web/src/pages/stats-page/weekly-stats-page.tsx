import { Book } from '@koinsight/common/types/book';
import { Flex, Loader, Title } from '@mantine/core';
import { JSX, useMemo } from 'react';
import { useBooks } from '../../api/books';
import { usePageStats } from '../../api/use-page-stats';
import { WeekStats } from './week-stats';

export function WeeklyStatsPage(): JSX.Element {
  const { data: books, isLoading: booksLoading } = useBooks();
  const {
    data: { stats },
    isLoading: statsLoading,
  } = usePageStats();

  const booksByMd5 = useMemo(() => {
    return books?.reduce(
      (acc, book) => {
        acc[book.md5] = book;
        return acc;
      },
      {} as Record<string, Book>
    );
  }, [books]);

  if (booksLoading || statsLoading) {
    return (
      <Flex justify="center" align="center" h="100%">
        <Loader />
      </Flex>
    );
  }

  return (
    <>
      <Title mb="md">Weekly stats</Title>
      <WeekStats stats={stats} booksByMd5={booksByMd5} />
    </>
  );
}
