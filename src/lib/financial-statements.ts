export type FinancialStatementAccountInput = {
  id: string;
  code: string;
  name: string;
  account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
  debit_total: string;
  credit_total: string;
};

export type FinancialStatementLine = {
  id: string;
  code: string;
  name: string;
  accountType: FinancialStatementAccountInput["account_type"];
  amountCents: bigint;
};

export type FinancialStatementsReport = {
  periodFrom: string;
  periodTo: string;
  postedEntryCount: number;
  revenueCents: bigint;
  expenseCents: bigint;
  netIncomeCents: bigint;
  assetsCents: bigint;
  liabilitiesCents: bigint;
  equityCents: bigint;
  cumulativeEarningsCents: bigint;
  liabilitiesEquityAndEarningsCents: bigint;
  balanceDifferenceCents: bigint;
  incomeLines: FinancialStatementLine[];
  balanceLines: FinancialStatementLine[];
};

function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseMoneyCents(value: unknown, label: string): bigint {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("أعاد الخادم " + label + " كقيمة غير صالحة.");
  }
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error("يجب أن يكون " + label + " مبلغًا صحيحًا بمنزلتين عشريتين كحد أقصى.");
  }
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole + fraction.padEnd(2, "0"));
}

function normalizeAccounts(
  accounts: readonly FinancialStatementAccountInput[],
  label: string,
): Map<string, { account: FinancialStatementAccountInput; debitCents: bigint; creditCents: bigint }> {
  const map = new Map<string, { account: FinancialStatementAccountInput; debitCents: bigint; creditCents: bigint }>();
  for (const account of accounts) {
    if (!account || typeof account.id !== "string" || !account.id) {
      throw new Error("أعاد الخادم حساب " + label + " بمعرّف غير صالح.");
    }
    if (map.has(account.id)) throw new Error("يوجد حساب مكررة في بيانات " + label + ".");
    map.set(account.id, {
      account,
      debitCents: parseMoneyCents(account.debit_total, "إجمالي مدين الحساب " + account.code),
      creditCents: parseMoneyCents(account.credit_total, "إجمالي دائن الحساب " + account.code),
    });
  }
  return map;
}

export function buildFinancialStatements(
  periodAccounts: readonly FinancialStatementAccountInput[],
  cumulativeAccounts: readonly FinancialStatementAccountInput[],
  periodFrom: string,
  periodTo: string,
  postedEntryCount: number,
): FinancialStatementsReport {
  if (!isDateOnly(periodFrom) || !isDateOnly(periodTo) || periodFrom > periodTo) {
    throw new Error("فترة القوائم المالية غير صالحة؛ يجب أن يكون التاريخان صحيحين والبداية قبل النهاية أو مساويًا لها.");
  }
  if (!Number.isInteger(postedEntryCount) || postedEntryCount < 0) {
    throw new Error("عدد القيود المرحلة غير صالح.");
  }

  const period = normalizeAccounts(periodAccounts, "الفترة");
  const cumulative = normalizeAccounts(cumulativeAccounts, "التراكمية");

  let revenueCents = 0n;
  let expenseCents = 0n;
  const incomeLines: FinancialStatementLine[] = [];
  for (const { account, debitCents, creditCents } of period.values()) {
    if (account.account_type === "revenue") {
      const amount = creditCents - debitCents;
      revenueCents += amount;
      incomeLines.push({ id: account.id, code: account.code, name: account.name, accountType: account.account_type, amountCents: amount });
    } else if (account.account_type === "expense") {
      const amount = debitCents - creditCents;
      expenseCents += amount;
      incomeLines.push({ id: account.id, code: account.code, name: account.name, accountType: account.account_type, amountCents: amount });
    }
  }
  incomeLines.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  let assetsCents = 0n;
  let liabilitiesCents = 0n;
  let equityCents = 0n;
  let cumulativeRevenue = 0n;
  let cumulativeExpense = 0n;
  const balanceLines: FinancialStatementLine[] = [];
  for (const { account, debitCents, creditCents } of cumulative.values()) {
    switch (account.account_type) {
      case "asset": {
        const amount = debitCents - creditCents;
        assetsCents += amount;
        balanceLines.push({ id: account.id, code: account.code, name: account.name, accountType: account.account_type, amountCents: amount });
        break;
      }
      case "liability": {
        const amount = creditCents - debitCents;
        liabilitiesCents += amount;
        balanceLines.push({ id: account.id, code: account.code, name: account.name, accountType: account.account_type, amountCents: amount });
        break;
      }
      case "equity": {
        const amount = creditCents - debitCents;
        equityCents += amount;
        balanceLines.push({ id: account.id, code: account.code, name: account.name, accountType: account.account_type, amountCents: amount });
        break;
      }
      case "revenue":
        cumulativeRevenue += creditCents - debitCents;
        break;
      case "expense":
        cumulativeExpense += debitCents - creditCents;
        break;
    }
  }
  balanceLines.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const netIncomeCents = revenueCents - expenseCents;
  const cumulativeEarningsCents = cumulativeRevenue - cumulativeExpense;
  const liabilitiesEquityAndEarningsCents = liabilitiesCents + equityCents + cumulativeEarningsCents;
  const balanceDifferenceCents = assetsCents - liabilitiesEquityAndEarningsCents;

  return {
    periodFrom,
    periodTo,
    postedEntryCount,
    revenueCents,
    expenseCents,
    netIncomeCents,
    assetsCents,
    liabilitiesCents,
    equityCents,
    cumulativeEarningsCents,
    liabilitiesEquityAndEarningsCents,
    balanceDifferenceCents,
    incomeLines,
    balanceLines,
  };
}

export function formatStatementCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const text = absolute.toString().padStart(3, "0");
  const whole = text.slice(0, -2);
  const fraction = text.slice(-2);
  const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (negative ? "−" : "") + withSeparators + "." + fraction + " ر.ي";
}
