import React from 'react';

const CUSTOM_RATE_HEADERS = [
  'customRate.name','customRateDetailNum','cityNameOrig','stateOrig','countryOrig',
  'postalCodeMinOrig','postalCodeMaxOrig','areaOrig','locOrig','cityNameDest',
  'stateDest','countryDest','postalCodeMinDest','postalCodeMaxDest','areaDest',
  'locDest','weightTierMin','weightTierMinUOM','weightTierMax','weightTierMaxUOM',
  'palletCountTierMin','palletCountTierMax','distanceTierMin','distanceTierMinUOM',
  'distanceTierMax','distanceTierMaxUOM','pieceCountTierMin','pieceCountTierMax',
  'volumeTierMin','volumeTierMinUOM','volumeTierMax','volumeTierMaxUOM',
  'dimensionTierMinTrailerLengthUsage','dimensionTierMinTrailerLengthUsageUOM',
  'dimensionTierMaxTrailerLengthUsage','dimensionTierMaxTrailerLengthUsageUOM',
  'densityTierMin','densityTierMinUOM','densityTierMax','densityTierMaxUOM',
  'areaTierMin','areaTierMinUOM','areaTierMax','areaTierMaxUOM',
  'weightDeficitWtMax','weightDeficitWtMaxUOM','durationTierMin','durationTierMax',
  'useDirect','directDiscount','directAbsMin','directMinChargeDiscount',
  'useOrigInterlinePartner','origInterlinePartnerDiscount','origInterlinePartnerAbsMin',
  'origInterlinePartnerMinChargeDiscount','useDestInterlinePartner',
  'destInterlinePartnerDiscount','destInterlinePartnerAbsMin',
  'destInterlinePartnerMinChargeDiscount','useBothOrigDestInterlinePartner',
  'bothOrigDestInterlinePartnerDiscount','bothOrigDestInterlinePartnerAbsMin',
  'bothOrigDestInterlinePartnerMinChargeDiscount','minCharge','maxCharge',
  'rateBreakValues','freightClassValues','truckloadFillBasis','rateQualifier',
  'effectiveDate','expirationDate',
];

function buildExportRows(results, contractNumber) {
  const rows = [];
  let detailNum = 1;

  for (const lane of results) {
    for (const rate of lane.rates) {
      const row = new Array(CUSTOM_RATE_HEADERS.length).fill('');

      // Map known fields to the 65-column template
      row[0] = `${contractNumber}-${rate.carrier}`;       // customRate.name
      row[1] = String(detailNum++);                        // customRateDetailNum
      row[4] = 'US';                                       // countryOrig
      row[5] = lane.origin_zip;                            // postalCodeMinOrig
      row[6] = lane.origin_zip;                            // postalCodeMaxOrig
      row[11] = 'US';                                      // countryDest
      row[12] = lane.dest_zip;                             // postalCodeMinDest
      row[13] = lane.dest_zip;                             // postalCodeMaxDest
      row[16] = lane.weight_lbs;                           // weightTierMin
      row[17] = 'LBS';                                     // weightTierMinUOM
      row[18] = lane.weight_lbs;                           // weightTierMax
      row[19] = 'LBS';                                     // weightTierMaxUOM
      row[26] = lane.pieces;                               // pieceCountTierMin
      row[27] = lane.pieces;                               // pieceCountTierMax
      row[48] = 'Y';                                       // useDirect
      row[49] = String(rate.totalCost);                    // directDiscount (total cost)
      row[67] = lane.freight_class;                        // freightClassValues

      rows.push(row);
    }
  }

  return rows;
}

function ExportButton({ results, contractNumber }) {
  const handleExport = () => {
    const dataRows = buildExportRows(results, contractNumber);

    if (dataRows.length === 0) {
      alert('No rate data to export.');
      return;
    }

    const csvContent = [
      CUSTOM_RATE_HEADERS.join(','),
      ...dataRows.map((row) =>
        row.map((val) => {
          const str = String(val);
          return str.includes(',') ? `"${str}"` : str;
        }).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom_rate_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="export-section">
      <button className="btn-export" onClick={handleExport}>
        Export to 3G Custom Rate Template CSV
      </button>
    </div>
  );
}

export default ExportButton;
