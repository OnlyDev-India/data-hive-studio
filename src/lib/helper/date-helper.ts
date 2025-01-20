export const isValidDate = (date: any): boolean => {
  return date instanceof Date && !isNaN(date.getTime());
};
