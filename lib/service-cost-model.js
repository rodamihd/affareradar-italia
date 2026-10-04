function num(v) {
  const n = Number(String(v ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function serviceCostModel(input = {}) {
  const monthly = num(input.monthlyPrice ?? input.recurringPrice);
  const activation = num(input.activationCost);
  const modemUpfront = num(input.modemUpfrontCost);
  const modemMonthly = num(input.modemMonthlyCost);
  const simCost = num(input.simCost);
  const mandatoryMonthly = num(input.mandatoryMonthlyExtras);
  const mandatoryUpfront = num(input.mandatoryUpfrontExtras);
  const promoMonths = Math.max(0, num(input.promoMonths));
  const promoMonthly = num(input.promoMonthlyPrice);
  const standardMonthly = monthly;
  const exitCost = num(input.exitCost ?? input.cancellationCost);

  function totalFor(months) {
    let recurringTotal = 0;
    for (let m = 1; m <= months; m++) {
      const base = promoMonths > 0 && m <= promoMonths && promoMonthly > 0 ? promoMonthly : standardMonthly;
      recurringTotal += base + modemMonthly + mandatoryMonthly;
    }
    return recurringTotal + activation + modemUpfront + simCost + mandatoryUpfront;
  }

  const total12 = totalFor(12);
  const total24 = totalFor(24);

  return {
    schema:"affareradar.service-cost.v1",
    monthlyHeadline:monthly,
    total12Months:Number(total12.toFixed(2)),
    total24Months:Number(total24.toFixed(2)),
    effectiveMonthly12:Number((total12 / 12).toFixed(2)),
    effectiveMonthly24:Number((total24 / 24).toFixed(2)),
    activationCost:activation,
    modemUpfrontCost:modemUpfront,
    modemMonthlyCost:modemMonthly,
    simCost,
    mandatoryMonthlyExtras:mandatoryMonthly,
    mandatoryUpfrontExtras:mandatoryUpfront,
    exitCost,
    promoMonths,
    promoMonthlyPrice:promoMonthly || null
  };
}
