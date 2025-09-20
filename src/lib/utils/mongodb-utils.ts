/**
 * MongoDB Utility Functions
 * These functions create proper MongoDB data types
 */


export const ObjectId = (id?: string) => {
  if (id && typeof id === 'string') {
    // Validate ObjectId format (24 hex characters)
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new Error('Invalid ObjectId format. Must be 24 hex characters.');
    }
    return id;
  }
  // Generate new ObjectId if none provided
  const timestamp = Math.floor(Date.now() / 1000).toString(16);
  const random = Math.random().toString(16).substring(2, 10);
  const counter = Math.floor(Math.random() * 16777216).toString(16).padStart(6, '0');
  return timestamp + random + counter;
};

export const ISODate = (dateString?: string) => {
  if (dateString) {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date string provided to ISODate');
    }
    return date;
  }
  return new Date();
};

export const NumberInt = (value: any) => {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error('Invalid value provided to NumberInt');
  }
  return { $numberInt: num.toString() };
};

export const NumberLong = (value: any) => {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error('Invalid value provided to NumberLong');
  }
  return { $numberLong: num.toString() };
};

export const NumberDouble = (value: any) => {
  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new Error('Invalid value provided to NumberDouble');
  }
  return { $numberDouble: num.toString() };
};

export const NumberDecimal = (value: any) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('NumberDecimal requires a string or number value');
  }
  return { $numberDecimal: value.toString() };
};

export const Binary = (data: any, subType = 0) => {
  if (typeof data === 'string') {
    // Convert string to base64 if it's not already
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      data = btoa(data);
    }
  }
  return { $binary: { base64: data, subType: subType.toString(16).padStart(2, '0') } };
};

export const Timestamp = (seconds?: number, increment = 1) => {
  if (seconds === undefined) {
    seconds = Math.floor(Date.now() / 1000);
  }
  return { $timestamp: { t: seconds, i: increment } };
};

export const RegExp = (pattern: string, options = '') => {
  return { $regularExpression: { pattern: pattern, options: options } };
};

export const MinKey = () => {
  return { $minKey: 1 };
};

export const MaxKey = () => {
  return { $maxKey: 1 };
};

export const Code = (code: string, scope = {}) => {
  return { $code: code, $scope: scope };
};

export const DBRef = (collection: string, id: any, database?: string) => {
  const ref:any = { $ref: collection, $id: id };
  if (database) {
    ref.$db = database;
  }
  return ref;
};
