/**
 * Browser-side XML builder for 3G TMS Rating API requests.
 * Uses string concatenation — no external dependencies.
 */

function esc(val) {
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function padPostalCode(code) {
  if (!code) return '';
  const s = String(code).trim();
  if (/^\d+$/.test(s) && s.length < 5) return s.padStart(5, '0');
  return s;
}

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

function resolveParams(row, sidebarParams) {
  const val = (key) => {
    const v = row[key];
    return (v !== undefined && v !== null && String(v).trim() !== '') ? String(v).trim() : null;
  };

  let contractUseList = [];
  const rowBlanketCost = val('Blanket Cost');
  const rowClientCost = val('Client Cost');
  const rowBlanketBill = val('Blanket Bill');
  const rowClientBill = val('Client Bill');

  if (rowBlanketCost !== null || rowClientCost !== null || rowBlanketBill !== null || rowClientBill !== null) {
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
    contractStatus: val('Cont. Status')
      ? [val('Cont. Status')]
      : (Array.isArray(sidebarParams.contractStatus)
          ? sidebarParams.contractStatus
          : [sidebarParams.contractStatus || 'BeingEntered']),
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

export function buildRatingRequest(row, sidebarParams, session) {
  const ep = resolveParams(row, sidebarParams);
  const lines = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<tns:RatingRequest');
  lines.push('  xmlns:tns="http://schemas.3gtms.com/tms/v1/services/rating"');
  lines.push('  xmlns:tns1="http://schemas.3gtms.com/tms/v1/services/rating"');
  lines.push('  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  lines.push('  xsi:schemaLocation="http://schemas.3gtms.com/tms/v1/services/rating 3GTMSRatingRequest.xsd">');

  lines.push(`  <RequestToken>${esc(row['Reference'] || '')}</RequestToken>`);

  // Configuration
  lines.push('  <Configuration>');
  if (ep.contRef) {
    lines.push(`    <Contract><ContractRef>${esc(ep.contRef)}</ContractRef></Contract>`);
  }
  if (ep.clientTPNum) {
    lines.push(`    <Client><TradingPartnerNum>${esc(ep.clientTPNum)}</TradingPartnerNum></Client>`);
  }
  if (ep.carrierTPNum) {
    lines.push(`    <Carrier><TradingPartnerNum>${esc(ep.carrierTPNum)}</TradingPartnerNum></Carrier>`);
  }
  const contractUseStr = ep.contractUse.length > 0 ? ` ${ep.contractUse.join(' ')} ` : '';
  lines.push(`    <ContractUse>${esc(contractUseStr)}</ContractUse>`);
  const contractStatusStr = ep.contractStatus.length > 0 ? ` ${ep.contractStatus.join(' ')} ` : '';
  lines.push(`    <ContractStatus>${esc(contractStatusStr)}</ContractStatus>`);
  lines.push(`    <SkipCarrierSafetyCheck>${ep.skipSafety ? '1' : '0'}</SkipCarrierSafetyCheck>`);
  lines.push(`    <EnableRoutingGuides>${ep.useRoutingGuides ? '1' : '0'}</EnableRoutingGuides>`);
  lines.push(`    <IncludeCostPlusMarkup>${ep.showTMSMarkup ? 'true' : 'false'}</IncludeCostPlusMarkup>`);
  if (ep.useRoutingGuides && ep.forceRoutingGuideName) {
    lines.push(`    <ForceRoutingGuideName>${esc(ep.forceRoutingGuideName)}</ForceRoutingGuideName>`);
  }
  lines.push(`    <NumberOfRates>${ep.numberOfRates}</NumberOfRates>`);
  lines.push('  </Configuration>');

  // PickupDate
  lines.push(`  <PickupDate>${formatPickupDate(row['Pickup Date'], session.utcOffset)}</PickupDate>`);
  if (row['Del. Date'] && String(row['Del. Date']).trim()) {
    lines.push(`  <DeliveryDate>${formatPickupDate(row['Del. Date'], session.utcOffset)}</DeliveryDate>`);
  }

  // Stops
  lines.push('  <Stops>');
  let stopIndex = 1;

  // Origin
  lines.push('    <Stop>');
  lines.push(`      <Index>${stopIndex++}</Index>`);
  lines.push('      <Location>');
  if (row['Orig City']) lines.push(`        <City>${esc(row['Orig City'])}</City>`);
  if (row['Org State']) lines.push(`        <State><Code>${esc(row['Org State'])}</Code></State>`);
  lines.push(`        <PostalCode>${esc(padPostalCode(row['Org Postal Code']))}</PostalCode>`);
  lines.push(`        <Country><FipsCode>${esc(row['Orig Cntry'] || 'US')}</FipsCode></Country>`);
  if (row['Orig Locnum']) lines.push(`        <LocationNumber>${esc(row['Orig Locnum'])}</LocationNumber>`);
  lines.push('      </Location>');
  lines.push('    </Stop>');

  // Additional stops
  const additionalStops = row['Additional Stops'];
  if (additionalStops === '1' || additionalStops === 'true' || additionalStops === 'TRUE') {
    for (let i = 1; i <= 5; i++) {
      const postal = row[`Stop ${i} Postal Code`];
      if (postal && String(postal).trim()) {
        lines.push('    <Stop>');
        lines.push(`      <Index>${stopIndex++}</Index>`);
        lines.push('      <Location>');
        if (row[`Stop ${i} City`]) lines.push(`        <City>${esc(row[`Stop ${i} City`])}</City>`);
        if (row[`Stop ${i} State`]) lines.push(`        <State><Code>${esc(row[`Stop ${i} State`])}</Code></State>`);
        lines.push(`        <PostalCode>${esc(padPostalCode(postal))}</PostalCode>`);
        lines.push(`        <Country><FipsCode>${esc(row[`Stop ${i} Country`] || 'US')}</FipsCode></Country>`);
        const locKey = i === 5 ? `Stop ${i} Loc` : `Stop ${i} Locnum`;
        if (row[locKey]) lines.push(`        <LocationNumber>${esc(row[locKey])}</LocationNumber>`);
        lines.push('      </Location>');
        lines.push('    </Stop>');
      }
    }
  }

  // Destination
  lines.push('    <Stop>');
  lines.push(`      <Index>${stopIndex}</Index>`);
  lines.push('      <Location>');
  if (row['DstCity']) lines.push(`        <City>${esc(row['DstCity'])}</City>`);
  if (row['Dst State']) lines.push(`        <State><Code>${esc(row['Dst State'])}</Code></State>`);
  lines.push(`        <PostalCode>${esc(padPostalCode(row['Dst Postal Code']))}</PostalCode>`);
  lines.push(`        <Country><FipsCode>${esc(row['Dst Cntry'] || 'US')}</FipsCode></Country>`);
  if (row['Dest Locnum']) lines.push(`        <LocationNumber>${esc(row['Dest Locnum'])}</LocationNumber>`);
  lines.push('      </Location>');
  lines.push('    </Stop>');
  lines.push('  </Stops>');

  // Freight
  lines.push('  <Freight>');
  const hazmat = row['Hazmat'];
  lines.push(`    <Hazmat>${(hazmat === '1' || hazmat === 'true' || hazmat === 'TRUE') ? 'true' : 'false'}</Hazmat>`);
  lines.push('    <LineItems>');

  const suffixes = ['', '.2', '.3', '.4', '.5'];
  for (const suffix of suffixes) {
    const classKey = suffix ? `Class${suffix}` : 'Class';
    const classVal = row[classKey];
    if (!classVal || !String(classVal).trim()) continue;

    lines.push('      <LineItem>');
    const huType = row[suffix ? `HU Type${suffix}` : 'Handlng Unit'];
    if (huType && String(huType).trim()) {
      lines.push(`        <HandlingUnitName>${esc(String(huType).trim())}</HandlingUnitName>`);
    }
    const ttlHUs = row[suffix ? `Ttl HUs${suffix}` : 'Ttl HUs'];
    lines.push(`        <HandlingUnitQuantity>${esc(String(ttlHUs || '1').trim() || '1')}</HandlingUnitQuantity>`);
    const pcs = row[suffix ? `Pcs${suffix}` : 'Pcs'];
    lines.push(`        <PieceCount>${esc(String(pcs || '1').trim() || '1')}</PieceCount>`);

    const netWt = row[suffix ? `Net Wt Lb${suffix}` : 'Net Wt Lb'];
    const grossWt = row[suffix ? `Gross Wt Lb${suffix}` : 'Gross Wt Lb'];
    lines.push(`        <NetWeight UOM="${esc(session.weightUOM)}">${esc(String(netWt || '0').trim())}</NetWeight>`);
    lines.push(`        <GrossWeight UOM="${esc(session.weightUOM)}">${esc(String(grossWt || netWt || '0').trim())}</GrossWeight>`);

    const netVol = row[suffix ? `Net Vol CuFt${suffix}` : 'Net Vol CuFt'];
    const grossVol = row[suffix ? `Gross Vol CuFt${suffix}` : 'Gross Vol CuFt'];
    if (netVol && String(netVol).trim()) {
      lines.push(`        <NetVolume UOM="${esc(session.volumeUOM)}">${esc(String(netVol).trim())}</NetVolume>`);
    }
    if (grossVol && String(grossVol).trim()) {
      lines.push(`        <GrossVolume UOM="${esc(session.volumeUOM)}">${esc(String(grossVol).trim())}</GrossVolume>`);
    }

    const lgth = row[suffix ? `Lgth Ft${suffix}` : 'Lgth Ft'];
    const hght = row[suffix ? `Hght Ft${suffix}` : 'Hght Ft'];
    const dpth = row[suffix ? `Dpth Ft${suffix}` : 'Dpth Ft'];
    if (lgth && String(lgth).trim()) lines.push(`        <Length UOM="${esc(session.dimensionUOM)}">${esc(String(lgth).trim())}</Length>`);
    if (hght && String(hght).trim()) lines.push(`        <Height UOM="${esc(session.dimensionUOM)}">${esc(String(hght).trim())}</Height>`);
    if (dpth && String(dpth).trim()) lines.push(`        <Depth UOM="${esc(session.dimensionUOM)}">${esc(String(dpth).trim())}</Depth>`);

    lines.push(`        <FreightClassification>${esc(String(classVal).trim())}</FreightClassification>`);
    lines.push('      </LineItem>');
  }

  lines.push('    </LineItems>');
  lines.push('  </Freight>');

  // Accessorials
  lines.push('  <Accessorials>');
  const accSuffixes = ['', '2', '3', '4', '5'];
  for (const suffix of accSuffixes) {
    const codeKey = suffix ? `Acc. Code${suffix}` : 'Acc. Code';
    const qtyKey = suffix ? `Quantity${suffix}` : 'Quantity';
    const reqKey = suffix ? `Required${suffix}` : 'Required';
    const code = row[codeKey];
    if (code && String(code).trim()) {
      const reqVal = row[reqKey];
      lines.push('    <Accessorial>');
      lines.push(`      <Code>${esc(String(code).trim())}</Code>`);
      lines.push(`      <Quantity>${esc(String(row[qtyKey] || '0').trim() || '0')}</Quantity>`);
      lines.push(`      <Required>${(reqVal === '1' || reqVal === 'true' || reqVal === 'TRUE') ? 'true' : 'false'}</Required>`);
      lines.push('    </Accessorial>');
    }
  }
  lines.push('  </Accessorials>');

  lines.push('</tns:RatingRequest>');
  return lines.join('\n');
}

export function buildTestRequest(session) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}T00:00:00-${session.utcOffset || '05:00'}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<tns:RatingRequest
  xmlns:tns="http://schemas.3gtms.com/tms/v1/services/rating"
  xmlns:tns1="http://schemas.3gtms.com/tms/v1/services/rating"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://schemas.3gtms.com/tms/v1/services/rating 3GTMSRatingRequest.xsd">
  <RequestToken>connection-test</RequestToken>
  <Configuration>
    <ContractUse> ClientCost </ContractUse>
    <ContractStatus> ${(session.contractStatus || ['BeingEntered']).join(' ')} </ContractStatus>
    <SkipCarrierSafetyCheck>1</SkipCarrierSafetyCheck>
    <EnableRoutingGuides>0</EnableRoutingGuides>
    <IncludeCostPlusMarkup>false</IncludeCostPlusMarkup>
    <NumberOfRates>1</NumberOfRates>
  </Configuration>
  <PickupDate>${dateStr}</PickupDate>
  <Stops>
    <Stop>
      <Index>1</Index>
      <Location>
        <PostalCode>10001</PostalCode>
        <Country><FipsCode>US</FipsCode></Country>
      </Location>
    </Stop>
    <Stop>
      <Index>2</Index>
      <Location>
        <PostalCode>90210</PostalCode>
        <Country><FipsCode>US</FipsCode></Country>
      </Location>
    </Stop>
  </Stops>
  <Freight>
    <Hazmat>false</Hazmat>
    <LineItems>
      <LineItem>
        <HandlingUnitQuantity>1</HandlingUnitQuantity>
        <PieceCount>1</PieceCount>
        <NetWeight UOM="Lb">100</NetWeight>
        <GrossWeight UOM="Lb">100</GrossWeight>
        <FreightClassification>70</FreightClassification>
      </LineItem>
    </LineItems>
  </Freight>
  <Accessorials/>
</tns:RatingRequest>`;
}
