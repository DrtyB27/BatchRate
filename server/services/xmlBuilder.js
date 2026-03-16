const { create } = require('xmlbuilder2');

/**
 * Pads US postal codes to 5 digits.
 */
function padPostalCode(code) {
  if (!code) return '';
  const s = String(code).trim();
  if (/^\d+$/.test(s) && s.length < 5) {
    return s.padStart(5, '0');
  }
  return s;
}

/**
 * Formats a pickup date. If empty, uses today.
 * Output: YYYY-MM-DDT00:00:00-{utcOffset}
 */
function formatPickupDate(dateStr, utcOffset) {
  let d;
  if (dateStr && dateStr.trim()) {
    d = new Date(dateStr.trim());
    if (isNaN(d.getTime())) d = new Date();
  } else {
    d = new Date();
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T00:00:00-${utcOffset}`;
}

/**
 * Resolves effective parameters: row-level overrides take precedence over sidebar defaults.
 */
function resolveParams(row, sidebarParams) {
  const val = (rowKey) => {
    const v = row[rowKey];
    return (v !== undefined && v !== null && String(v).trim() !== '') ? String(v).trim() : null;
  };

  // Contract use: check row-level overrides, fall back to sidebar
  let contractUseList = [];
  const rowBlanketCost = val('Blanket Cost');
  const rowClientCost = val('Client Cost');
  const rowBlanketBill = val('Blanket Bill');
  const rowClientBill = val('Client Bill');

  if (rowBlanketCost !== null || rowClientCost !== null || rowBlanketBill !== null || rowClientBill !== null) {
    // Row has contract use overrides
    if (rowBlanketCost === '1' || rowBlanketCost === 'true' || rowBlanketCost === 'TRUE') contractUseList.push('BlanketCost');
    if (rowClientCost === '1' || rowClientCost === 'true' || rowClientCost === 'TRUE') contractUseList.push('ClientCost');
    if (rowBlanketBill === '1' || rowBlanketBill === 'true' || rowBlanketBill === 'TRUE') contractUseList.push('BlanketBilling');
    if (rowClientBill === '1' || rowClientBill === 'true' || rowClientBill === 'TRUE') contractUseList.push('ClientBilling');
  } else {
    contractUseList = [...(sidebarParams.contractUse || ['ClientCost'])];
  }

  const skipSafetyRow = val('Skip Safety');
  let skipSafety;
  if (skipSafetyRow !== null) {
    skipSafety = (skipSafetyRow === '1' || skipSafetyRow === 'true' || skipSafetyRow === 'TRUE');
  } else {
    skipSafety = sidebarParams.skipSafety !== undefined ? sidebarParams.skipSafety : true;
  }

  return {
    contRef: val('Cont. Ref') || sidebarParams.contRef || '',
    contractStatus: val('Cont. Status') || sidebarParams.contractStatus || 'BeingEntered',
    clientTPNum: val('Client TP Num') || sidebarParams.clientTPNum || '',
    carrierTPNum: val('Carrier TP Num') || sidebarParams.carrierTPNum || '',
    skipSafety,
    contractUse: contractUseList,
    useRoutingGuides: sidebarParams.useRoutingGuides || false,
    forceRoutingGuideName: sidebarParams.forceRoutingGuideName || '',
    numberOfRates: sidebarParams.numberOfRates || 4,
    showTMSMarkup: sidebarParams.showTMSMarkup || false,
  };
}

/**
 * Builds a full 3G TMS RatingRequest XML for one CSV row.
 */
function buildRatingRequest(row, sidebarParams, session) {
  const ep = resolveParams(row, sidebarParams);

  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('tns:RatingRequest', {
    'xmlns:tns': 'http://schemas.3gtms.com/tms/v1/services/rating',
    'xmlns:tns1': 'http://schemas.3gtms.com/tms/v1/services/rating',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation': 'http://schemas.3gtms.com/tms/v1/services/rating 3GTMSRatingRequest.xsd',
  });

  // RequestToken
  root.ele('RequestToken').txt(row['Reference'] || '').up();

  // Configuration
  const config = root.ele('Configuration');

  if (ep.contRef) {
    config.ele('Contract').ele('ContractRef').txt(ep.contRef).up().up();
  }
  if (ep.clientTPNum) {
    config.ele('Client').ele('TradingPartnerNum').txt(ep.clientTPNum).up().up();
  }
  if (ep.carrierTPNum) {
    config.ele('Carrier').ele('TradingPartnerNum').txt(ep.carrierTPNum).up().up();
  }

  const contractUseStr = ep.contractUse.length > 0 ? ` ${ep.contractUse.join(' ')} ` : '';
  config.ele('ContractUse').txt(contractUseStr).up();
  config.ele('ContractStatus').txt(ep.contractStatus).up();
  config.ele('SkipCarrierSafetyCheck').txt(ep.skipSafety ? '1' : '0').up();
  config.ele('EnableRoutingGuides').txt(ep.useRoutingGuides ? '1' : '0').up();
  config.ele('IncludeCostPlusMarkup').txt(ep.showTMSMarkup ? 'true' : 'false').up();

  if (ep.useRoutingGuides && ep.forceRoutingGuideName) {
    config.ele('ForceRoutingGuideName').txt(ep.forceRoutingGuideName).up();
  }

  config.ele('NumberOfRates').txt(String(ep.numberOfRates)).up();
  config.up();

  // PickupDate
  const pickupDateStr = formatPickupDate(row['Pickup Date'], session.utcOffset);
  root.ele('PickupDate').txt(pickupDateStr).up();

  // Delivery date if provided
  if (row['Del. Date'] && String(row['Del. Date']).trim()) {
    root.ele('DeliveryDate').txt(formatPickupDate(row['Del. Date'], session.utcOffset)).up();
  }

  // Stops
  const stopsEle = root.ele('Stops');
  let stopIndex = 1;

  // Origin stop
  const origStop = stopsEle.ele('Stop');
  origStop.ele('Index').txt(String(stopIndex++)).up();
  const origLoc = origStop.ele('Location');
  if (row['Orig City']) origLoc.ele('City').txt(row['Orig City']).up();
  if (row['Org State']) origLoc.ele('State').ele('Code').txt(row['Org State']).up().up();
  origLoc.ele('PostalCode').txt(padPostalCode(row['Org Postal Code'])).up();
  origLoc.ele('Country').ele('FipsCode').txt(row['Orig Cntry'] || 'US').up().up();
  if (row['Orig Locnum']) origLoc.ele('LocationNumber').txt(row['Orig Locnum']).up();
  origLoc.up();
  origStop.up();

  // Additional stops
  const additionalStops = row['Additional Stops'];
  if (additionalStops === '1' || additionalStops === 'true' || additionalStops === 'TRUE') {
    for (let i = 1; i <= 5; i++) {
      const postalKey = `Stop ${i} Postal Code`;
      const postal = row[postalKey];
      if (postal && String(postal).trim()) {
        const stop = stopsEle.ele('Stop');
        stop.ele('Index').txt(String(stopIndex++)).up();
        const loc = stop.ele('Location');
        const cityKey = `Stop ${i} City`;
        const stateKey = `Stop ${i} State`;
        const countryKey = `Stop ${i} Country`;
        const locnumKey = i === 5 ? `Stop ${i} Loc` : `Stop ${i} Locnum`;
        if (row[cityKey]) loc.ele('City').txt(row[cityKey]).up();
        if (row[stateKey]) loc.ele('State').ele('Code').txt(row[stateKey]).up().up();
        loc.ele('PostalCode').txt(padPostalCode(postal)).up();
        loc.ele('Country').ele('FipsCode').txt(row[countryKey] || 'US').up().up();
        if (row[locnumKey]) loc.ele('LocationNumber').txt(row[locnumKey]).up();
        loc.up();
        stop.up();
      }
    }
  }

  // Destination stop
  const destStop = stopsEle.ele('Stop');
  destStop.ele('Index').txt(String(stopIndex)).up();
  const destLoc = destStop.ele('Location');
  if (row['DstCity']) destLoc.ele('City').txt(row['DstCity']).up();
  if (row['Dst State']) destLoc.ele('State').ele('Code').txt(row['Dst State']).up().up();
  destLoc.ele('PostalCode').txt(padPostalCode(row['Dst Postal Code'])).up();
  destLoc.ele('Country').ele('FipsCode').txt(row['Dst Cntry'] || 'US').up().up();
  if (row['Dest Locnum']) destLoc.ele('LocationNumber').txt(row['Dest Locnum']).up();
  destLoc.up();
  destStop.up();
  stopsEle.up();

  // Freight
  const freightEle = root.ele('Freight');
  const hazmat = row['Hazmat'];
  if (hazmat === '1' || hazmat === 'true' || hazmat === 'TRUE') {
    freightEle.ele('Hazmat').txt('true').up();
  } else {
    freightEle.ele('Hazmat').txt('false').up();
  }

  const lineItemsEle = freightEle.ele('LineItems');

  // Line item groups: 1 (no suffix), 2–5 (suffix .2 through .5)
  const suffixes = ['', '.2', '.3', '.4', '.5'];
  for (const suffix of suffixes) {
    const classKey = suffix ? `Class${suffix}` : 'Class';
    const classVal = row[classKey];
    if (!classVal || !String(classVal).trim()) continue;

    const li = lineItemsEle.ele('LineItem');

    const huType = row[suffix ? `HU Type${suffix}` : 'Handlng Unit'];
    if (huType && String(huType).trim()) {
      li.ele('HandlingUnitName').txt(String(huType).trim()).up();
    }

    const ttlHUs = row[suffix ? `Ttl HUs${suffix}` : 'Ttl HUs'];
    li.ele('HandlingUnitQuantity').txt(String(ttlHUs || '1').trim() || '1').up();

    const pcs = row[suffix ? `Pcs${suffix}` : 'Pcs'];
    li.ele('PieceCount').txt(String(pcs || '1').trim() || '1').up();

    const netWt = row[suffix ? `Net Wt Lb${suffix}` : 'Net Wt Lb'];
    const grossWt = row[suffix ? `Gross Wt Lb${suffix}` : 'Gross Wt Lb'];
    li.ele('NetWeight', { UOM: session.weightUOM }).txt(String(netWt || '0').trim()).up();
    li.ele('GrossWeight', { UOM: session.weightUOM }).txt(String(grossWt || netWt || '0').trim()).up();

    const netVol = row[suffix ? `Net Vol CuFt${suffix}` : 'Net Vol CuFt'];
    const grossVol = row[suffix ? `Gross Vol CuFt${suffix}` : 'Gross Vol CuFt'];
    if (netVol && String(netVol).trim()) {
      li.ele('NetVolume', { UOM: session.volumeUOM }).txt(String(netVol).trim()).up();
    }
    if (grossVol && String(grossVol).trim()) {
      li.ele('GrossVolume', { UOM: session.volumeUOM }).txt(String(grossVol).trim()).up();
    }

    const lgth = row[suffix ? `Lgth Ft${suffix}` : 'Lgth Ft'];
    const hght = row[suffix ? `Hght Ft${suffix}` : 'Hght Ft'];
    const dpth = row[suffix ? `Dpth Ft${suffix}` : 'Dpth Ft'];
    if (lgth && String(lgth).trim()) {
      li.ele('Length', { UOM: session.dimensionUOM }).txt(String(lgth).trim()).up();
    }
    if (hght && String(hght).trim()) {
      li.ele('Height', { UOM: session.dimensionUOM }).txt(String(hght).trim()).up();
    }
    if (dpth && String(dpth).trim()) {
      li.ele('Depth', { UOM: session.dimensionUOM }).txt(String(dpth).trim()).up();
    }

    li.ele('FreightClassification').txt(String(classVal).trim()).up();
    li.up();
  }
  lineItemsEle.up();
  freightEle.up();

  // Accessorials
  const accessorialsEle = root.ele('Accessorials');
  const accSuffixes = ['', '2', '3', '4', '5'];
  for (const suffix of accSuffixes) {
    const codeKey = suffix ? `Acc. Code${suffix}` : 'Acc. Code';
    const qtyKey = suffix ? `Quantity${suffix}` : 'Quantity';
    const reqKey = suffix ? `Required${suffix}` : 'Required';
    const code = row[codeKey];
    if (code && String(code).trim()) {
      const acc = accessorialsEle.ele('Accessorial');
      acc.ele('Code').txt(String(code).trim()).up();
      acc.ele('Quantity').txt(String(row[qtyKey] || '0').trim() || '0').up();
      const reqVal = row[reqKey];
      acc.ele('Required').txt(
        (reqVal === '1' || reqVal === 'true' || reqVal === 'TRUE') ? 'true' : 'false'
      ).up();
      acc.up();
    }
  }
  accessorialsEle.up();

  root.up();
  return doc.end({ prettyPrint: true });
}

/**
 * Builds a minimal test XML request for connection verification.
 */
function buildTestRequest() {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('tns:RatingRequest', {
    'xmlns:tns': 'http://schemas.3gtms.com/tms/v1/services/rating',
    'xmlns:tns1': 'http://schemas.3gtms.com/tms/v1/services/rating',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation': 'http://schemas.3gtms.com/tms/v1/services/rating 3GTMSRatingRequest.xsd',
  });

  root.ele('RequestToken').txt('connection-test').up();
  root.ele('Configuration')
    .ele('ContractUse').txt(' ClientCost ').up()
    .ele('ContractStatus').txt('BeingEntered').up()
    .ele('SkipCarrierSafetyCheck').txt('1').up()
    .ele('EnableRoutingGuides').txt('0').up()
    .ele('IncludeCostPlusMarkup').txt('false').up()
    .ele('NumberOfRates').txt('1').up()
  .up();

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  root.ele('PickupDate').txt(`${yyyy}-${mm}-${dd}T00:00:00-05:00`).up();

  root.ele('Stops')
    .ele('Stop')
      .ele('Index').txt('1').up()
      .ele('Location')
        .ele('PostalCode').txt('10001').up()
        .ele('Country').ele('FipsCode').txt('US').up().up()
      .up()
    .up()
    .ele('Stop')
      .ele('Index').txt('2').up()
      .ele('Location')
        .ele('PostalCode').txt('90210').up()
        .ele('Country').ele('FipsCode').txt('US').up().up()
      .up()
    .up()
  .up();

  root.ele('Freight')
    .ele('Hazmat').txt('false').up()
    .ele('LineItems')
      .ele('LineItem')
        .ele('HandlingUnitQuantity').txt('1').up()
        .ele('PieceCount').txt('1').up()
        .ele('NetWeight', { UOM: 'Lb' }).txt('100').up()
        .ele('GrossWeight', { UOM: 'Lb' }).txt('100').up()
        .ele('FreightClassification').txt('70').up()
      .up()
    .up()
  .up();

  root.ele('Accessorials').up();
  root.up();

  return doc.end({ prettyPrint: true });
}

module.exports = { buildRatingRequest, buildTestRequest, resolveParams };
