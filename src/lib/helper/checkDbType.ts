export const isNoSql = (dbType: string) => {
  return ["mongodb"].includes(dbType);
};
