import { weburl } from './web.js';

let currentCompany = { id: '', name: '', proprietor: '', type: 'proprietorship', year: '', yearEnd: '', availableYears: [] };
let currentStep = 1;
const TOTAL_STEPS = 11;
let cashBalanceVal = 0; 
let isDirty = false;

let allCompaniesCache = [];
let currentCompanyYearsCache = [];

let finData = {
    openingStock: [], purchases: [], sales: [], closingStock: [],
    directExpenses: [], directIncomes: [], indirectExpenses: [], indirectIncomes: [],
    fixedAssets: [], bankBalance: [], receivables: [], partners: [],
    loansAdvancesAsset: [], currentAssets: [], otherCurrentAssets: [], 
    loansAdvancesLiab: [], currentLiabilities: [], otherCurrentLiabilities: [],
    settings: { 
        reportDate: '', reportPlace: '', sig1Name: '', sig1Title: '', sig2Name: '', sig2Title: '', 
        businessType: 'proprietorship', 
        trdBal: 'gp', trdTarget: 0, trdAutoName: 'Balancing Figure',
        pnlBal: 'np', pnlTarget: 0, pnlAutoName: 'Misc. Entry'
    },
    config: { schCA: false, schCL: false, schLAA: false, schLAL: false, schZeroAdd: false, schFaSub: false, schFA: false, schDebtors: false, schBank: false, schPartners: false, padPnl: 5, padBS: 0 }
};

const categories = [
    { id: 'openingStock', title: 'Opening Stock', step: 2 },
    { id: 'purchases', title: 'Purchases', step: 2 },
    { id: 'sales', title: 'Sales', step: 2 }, 
    { id: 'directExpenses', title: 'Direct Expenses', step: 2 },
    { id: 'directIncomes', title: 'Direct Incomes', step: 2 },
    { id: 'closingStock', title: 'Closing Stock', step: 2 },
    { id: 'indirectExpenses', title: 'Indirect Expenses', step: 3 },
    { id: 'indirectIncomes', title: 'Indirect Incomes', step: 3 },
    { id: 'partners', title: 'Partners / Directors details', isPartner: true, step: 4 },
    { id: 'loansAdvancesLiab', title: 'Loans & Advances (Liability)', step: 5 },
    { id: 'currentLiabilities', title: 'Sundry Creditors & Current Liab.', step: 6 },
    { id: 'otherCurrentLiabilities', title: 'Other Current Liabilities (Provisions/Taxes)', step: 7 },
    { id: 'fixedAssets', title: 'Fixed Assets (Gross Block)', hasRate: true, step: 8 },
    { id: 'bankBalance', title: 'Bank Balances', step: 9 },
    { id: 'receivables', title: 'Sundry Debtors', step: 9 },
    { id: 'currentAssets', title: 'Other Current Assets', step: 10 },
    { id: 'loansAdvancesAsset', title: 'Loans & Advances (Asset)', step: 10 }
];

const fmt = (num) => (num === undefined || num === null || num === '') ? '' : Number(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const capitalize = (s) => s ? s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '';
const formatDate = (ds) => {
    if (!ds) return '___________________';
    const d = new Date(ds);
    return isNaN(d.getTime()) ? ds : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const incrementFY = (fyStr, addYears) => {
    if(!fyStr) return '';
    let match = fyStr.match(/(\d{4})-(\d{2})/);
    if (match) {
        let p1 = parseInt(match[1]) + addYears;
        let p2 = parseInt(match[2]) + addYears;
        let p2Str = (p2 % 100).toString().padStart(2, '0');
        return `${p1}-${p2Str}`;
    }
    return incrementYearStr(fyStr, addYears); 
};
const incrementYearStr = (dateStr, addYears) => {
    if(!dateStr) return '';
    let parts = dateStr.split('-');
    if (parts.length === 3) {
        if (parts[0].length === 4) { parts[0] = parseInt(parts[0]) + addYears; } 
        else if (parts[2].length === 4) { parts[2] = parseInt(parts[2]) + addYears; }
        return parts.join('-');
    }
    return dateStr;
};

// --- AUTHENTICATION GATE (BACKEND CONNECTED) ---
window.checkAuth = async function() {
    let pin = document.getElementById('authPin').value;
    if(!pin) return;

    document.getElementById('authMsg').className = "text-primary small fw-bold mt-2";
    document.getElementById('authMsg').innerText = "Verifying with server...";

    try {
        let res = await fetch(`${weburl}?action=verifyPin&pin=${pin}`);
        let data = await res.json();

        if (data.status === 'success') {
            sessionStorage.setItem('authToken', data.token);
            document.getElementById('auth-screen').classList.add('d-none');
            fetchCompanies();
        } else if (data.status === 'locked') {
            document.getElementById('authMsg').className = "text-danger small fw-bold mt-2";
            document.getElementById('authMsg').innerText = `Locked out. Try again in ${data.mins} mins.`;
        } else {
            document.getElementById('authMsg').className = "text-danger small fw-bold mt-2";
            document.getElementById('authMsg').innerText = `Invalid PIN. ${data.attemptsLeft} attempts left.`;
        }
    } catch(e) {
        document.getElementById('authMsg').className = "text-danger small fw-bold mt-2";
        document.getElementById('authMsg').innerText = "Network Error. Could not connect to server.";
    }
}

// Wrapper for all backend GET calls to handle expired sessions elegantly
async function secureFetch(actionParams) {
    let token = sessionStorage.getItem('authToken');
    let res = await fetch(`${weburl}?sessionToken=${token}&${actionParams}`);
    let data = await res.json();
    if (data.status === 'error' && data.message === 'unauthorized') {
        sessionStorage.removeItem('authToken');
        document.getElementById('auth-screen').classList.remove('d-none');
        document.getElementById('authMsg').className = "text-danger small fw-bold mt-2";
        document.getElementById('authMsg').innerText = "Session expired. Please log in again.";
        throw new Error("Unauthorized");
    }
    return data;
}


window.getIsService = function(data = finData) {
    const s = (arr) => arr ? arr.reduce((a, b) => a + (parseFloat(b.amount)||0), 0) : 0;
    let trdBal = document.getElementById('trdBal') ? document.getElementById('trdBal').value : (data.settings?.trdBal || 'gp');
    return (s(data.openingStock) === 0 && s(data.purchases) === 0 && s(data.closingStock) === 0 && trdBal === 'gp');
};

function computeEngineMath(dataObj, baseSettings, mult = 1, overrideOpStock = null) {
    const sum = (arr) => arr ? arr.reduce((a, b) => a + (parseFloat(b.amount)||0), 0) : 0;
    const scale = (arr) => arr ? arr.map(i => ({...i, amount: Math.round((parseFloat(i.amount)||0) * mult * 100)/100})) : [];

    let pPur = scale(dataObj.purchases);
    let pSal = scale(dataObj.sales);
    let pDirE = scale(dataObj.directExpenses);
    let pDirI = scale(dataObj.directIncomes);
    let pIndE = scale(dataObj.indirectExpenses);
    let pIndI = scale(dataObj.indirectIncomes);
    let pClStock = scale(dataObj.closingStock);
    
    let pOpStock = overrideOpStock !== null ? overrideOpStock : scale(dataObj.openingStock);

    let tDepr = 0;
    let pAssets = dataObj.fixedAssets ? dataObj.fixedAssets.map(a => {
        let op = a.opening !== undefined ? parseFloat(a.opening) : (parseFloat(a.amount) || 0); 
        let add = parseFloat(a.addition) || 0; 
        let baseAmt = op + add; 
        let depAmt = a.depreciable ? Math.round(baseAmt * (parseFloat(a.rate) / 100)) : 0;
        tDepr += depAmt;
        return { name: a.name, opening: op, addition: add, depr: depAmt, amount: baseAmt - depAmt, depreciable: a.depreciable, rate: a.rate };
    }) : [];

    let vOpStock = sum(pOpStock); let vPur = sum(pPur); let vDirE = sum(pDirE);
    let vSal = sum(pSal); let vDirI = sum(pDirI); let vClStock = sum(pClStock);
    
    let hasTrading = (vOpStock !== 0 || vPur !== 0 || vClStock !== 0 || baseSettings.trdBal !== 'gp');
    
    let gp = 0, gl = 0;
    if (hasTrading) {
        let preDr = vOpStock + vPur + vDirE;
        let preCr = vSal + vDirI + vClStock;
        let preGP = preCr - preDr;
        let reqGP = Math.round((parseFloat(baseSettings.trdTarget) || 0) * mult * 100) / 100;

        if (baseSettings.trdBal === 'clStock') {
            let diff = reqGP - preGP; vClStock += diff; pClStock.push({name: baseSettings.trdAutoName, amount: diff}); gp = reqGP;
        } else if (baseSettings.trdBal === 'pur') {
            let diff = preGP - reqGP; vPur += diff; pPur.push({name: baseSettings.trdAutoName, amount: diff}); gp = reqGP;
        } else if (baseSettings.trdBal === 'sales') {
            let diff = reqGP - preGP; vSal += diff; pSal.push({name: baseSettings.trdAutoName, amount: diff}); gp = reqGP;
        } else if (baseSettings.trdBal === 'dirExp') {
            let diff = preGP - reqGP; vDirE += diff; pDirE.push({name: baseSettings.trdAutoName, amount: diff}); gp = reqGP;
        } else {
            gp = preGP >= 0 ? preGP : 0;
            gl = preGP < 0 ? Math.abs(preGP) : 0;
        }
    }

    let vIndE = sum(pIndE); let vIndI = sum(pIndI);
    let pnlPreDr = (hasTrading ? 0 : vDirE) + vIndE + tDepr + (hasTrading ? gl : 0);
    let pnlPreCr = (hasTrading ? gp : (vSal + vDirI)) + vIndI;
    let preNP = pnlPreCr - pnlPreDr;
    let autoTargetNP = preNP;

    if (baseSettings.pnlBal === 'indExp') {
        let reqNP = Math.round((parseFloat(baseSettings.pnlTarget) || 0) * mult * 100) / 100;
        let diff = preNP - reqNP; vIndE += diff; pIndE.push({name: baseSettings.pnlAutoName, amount: diff}); autoTargetNP = reqNP;
    } else if (baseSettings.pnlBal === 'indInc') {
        let reqNP = Math.round((parseFloat(baseSettings.pnlTarget) || 0) * mult * 100) / 100;
        let diff = reqNP - preNP; vIndI += diff; pIndI.push({name: baseSettings.pnlAutoName, amount: diff}); autoTargetNP = reqNP;
    }

    return { pOpStock, pPur, pSal, pClStock, pDirE, pDirI, pIndE, pIndI, pAssets, tDepr, vOpStock, vPur, vSal, vClStock, vDirE, vDirI, vIndE, vIndI, gp, gl, hasTrading, autoTargetNP };
}

function allocatePartnerCapital(partnersArray, targetProfit) {
    if (!partnersArray || partnersArray.length === 0) return { remunTotal: 0, intTotal: 0, divProfit: targetProfit, closingCap: 0 };
    
    let remunTotal = partnersArray.reduce((a, b) => a + (parseFloat(b.remun) || 0), 0);
    let intTotal = partnersArray.reduce((a, b) => a + (parseFloat(b.intCap) || 0), 0);
    let divProfit = Math.round((targetProfit - remunTotal - intTotal) * 100) / 100;
    let ratioTotal = partnersArray.reduce((a, b) => a + (parseFloat(b.ratio) || 0), 0);
    
    let closingCap = 0;
    let allocatedProfit = 0;
    
    partnersArray.forEach((p, idx) => {
        if (ratioTotal > 0) {
            if (idx === partnersArray.length - 1) {
                p.profitShare = Math.round((divProfit - allocatedProfit) * 100) / 100; 
            } else {
                p.profitShare = Math.round((divProfit * (parseFloat(p.ratio) / ratioTotal)) * 100) / 100;
                allocatedProfit += p.profitShare;
            }
        } else { p.profitShare = 0; }
        
        p.closingBal = (parseFloat(p.opening)||0) + (parseFloat(p.addCap)||0) + (parseFloat(p.remun)||0) + (parseFloat(p.intCap)||0) + p.profitShare - (parseFloat(p.draw)||0);
        closingCap += p.closingBal;
    });
    
    return { remunTotal, intTotal, divProfit, closingCap };
}

window.onload = () => { 
    if(sessionStorage.getItem('authToken')) {
        document.getElementById('auth-screen').classList.add('d-none');
        fetchCompanies();
    }
};

window.addEventListener('beforeunload', function (e) {
    if (isDirty) { e.preventDefault(); e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'; }
});

window.markDirty = function() { isDirty = true; window.calcLiveTally(); }

window.navExit = function() {
    if (!document.getElementById('view-companies').classList.contains('d-none')) return;
    if (!document.getElementById('view-dashboard').classList.contains('d-none')) {
        window.switchView('view-companies');
    } else {
        window.confirmExit('view-dashboard');
    }
}

window.confirmExit = function(targetView) {
    if (isDirty) {
        document.getElementById('uiModalTitle').innerText = 'Unsaved Changes';
        document.getElementById('uiModalBody').innerHTML = `<p class="mb-0 fw-bold text-danger">You have unsaved changes. Leaving will discard them.</p>`;
        document.getElementById('uiModalFooter').innerHTML = `<button type="button" class="btn btn-light rounded-pill px-4 fw-bold" data-bs-dismiss="modal">Stay Here</button><button type="button" class="btn btn-danger rounded-pill px-4 fw-bold" onclick="window.forceExit('${targetView}')">Discard</button>`;
        new bootstrap.Modal(document.getElementById('uiModal')).show();
    } else { window.switchView(targetView); }
}

window.forceExit = function(targetView) {
    bootstrap.Modal.getInstance(document.getElementById('uiModal')).hide();
    isDirty = false; window.switchView(targetView);
}

function customAlert(msg) {
    document.getElementById('uiModalTitle').innerText = 'Information';
    document.getElementById('uiModalBody').innerHTML = `<p class="mb-0 fw-bold">${msg}</p>`;
    document.getElementById('uiModalFooter').innerHTML = `<button type="button" class="btn btn-primary px-4 rounded-pill fw-bold" data-bs-dismiss="modal">OK</button>`;
    new bootstrap.Modal(document.getElementById('uiModal')).show();
}

function showLoader(text="Loading...") { document.getElementById('loaderText').innerText = text; document.getElementById('globalLoader').classList.remove('d-none'); }
function hideLoader() { document.getElementById('globalLoader').classList.add('d-none'); }

window.switchView = function(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('d-none'));
    document.getElementById(viewId).classList.remove('d-none');
    if(viewId === 'view-companies') fetchCompanies();
}

window.jumpToStep = function(step) {
    currentStep = step;
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.add('d-none'));
    const currentStepEl = document.getElementById(`step-${currentStep}`);
    if (currentStepEl) currentStepEl.classList.remove('d-none');
    document.querySelectorAll('.step-link').forEach(el => el.classList.remove('active'));
    const stepLinks = document.querySelectorAll('.step-link');
    if (stepLinks[currentStep - 1]) stepLinks[currentStep - 1].classList.add('active');
}

async function fetchCompanies() {
    if(!weburl) return;
    showLoader("Loading Companies...");
    try {
        const companies = await secureFetch(`action=getCompanies`);
        allCompaniesCache = companies;
        document.getElementById('searchCompanyInput').value = '';
        renderCompanyList(companies);
    } catch(e) { console.error(e); }
    hideLoader();
}

function renderCompanyList(companies) {
    const container = document.getElementById('company-cards-container');
    if(companies.length === 0) {
        container.innerHTML = `<div class="col-12 text-center py-5 text-muted fw-bold">No companies found.</div>`;
    } else {
        container.innerHTML = companies.map(c => `
            <div class="col-md-4 mb-4">
                <div class="card hover-card shadow-sm h-100" onclick="window.openDashboard('${c.id}', '${c.name.replace(/'/g, "\\'")}', '${c.proprietor.replace(/'/g, "\\'")}')">
                    <div class="card-body p-4">
                        <h5 class="card-title text-primary fw-bold">${c.name}</h5>
                        <p class="card-text small mb-1 text-muted"><strong>ID:</strong> ${c.id}</p>
                        <p class="card-text small text-dark fw-bold"><strong>Entity Detail:</strong> ${c.proprietor || 'N/A'}</p>
                    </div>
                </div>
            </div>`).join('');
    }
}

window.filterCompanies = function() {
    const q = document.getElementById('searchCompanyInput').value.toLowerCase();
    renderCompanyList(allCompaniesCache.filter(c => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || (c.proprietor && c.proprietor.toLowerCase().includes(q))));
}

window.openDashboard = async function(id, name, prop) {
    currentCompany = { ...currentCompany, id, name, proprietor: prop };
    document.getElementById('dash-comp-name').innerText = name;
    document.getElementById('dash-comp-prop').innerText = `Entity Detail: ${prop}`;
    showLoader("Loading Years...");
    try {
        const years = await secureFetch(`action=getCompanyYears&companyId=${id}`);
        currentCompany.availableYears = years;
        currentCompanyYearsCache = years;
        document.getElementById('searchYearInput').value = '';
        renderYearList(years);
        window.switchView('view-dashboard');
    } catch(e) { console.error(e); }
    hideLoader();
}

function renderYearList(years) {
    const cont = document.getElementById('dash-years-container');
    if(years.length === 0) {
        cont.innerHTML = '<div class="col-12 text-muted fw-bold p-3">No years found. Create one to begin.</div>';
    } else {
        cont.innerHTML = years.map(y => `
            <div class="col-md-3 mb-4">
                <div class="year-card hover-card" onclick="window.loadYearData('${y}')">
                    <h3 class="mb-2 fw-bold text-dark">${y}</h3>
                    <span class="text-primary small fw-bold text-uppercase tracking-wide">Edit Data &rarr;</span>
                </div>
            </div>`).join('');
    }
}

window.filterYears = function() {
    const q = document.getElementById('searchYearInput').value.toLowerCase();
    renderYearList(currentCompanyYearsCache.filter(y => y.toLowerCase().includes(q)));
}

window.openNewCompanyModal = function() {
    document.getElementById('newCompId').value = "CID-" + String(Math.floor(100 + Math.random() * 900));
    document.getElementById('newCompName').value = '';
    document.getElementById('newProprietor').value = '';
    new bootstrap.Modal(document.getElementById('newCompanyModal')).show();
}

window.initNewCompany = function() {
    currentCompany = {
        id: document.getElementById('newCompId').value,
        name: capitalize(document.getElementById('newCompName').value),
        proprietor: capitalize(document.getElementById('newProprietor').value),
        type: document.getElementById('newCompType').value,
        availableYears: []
    };
    if(currentCompany.type === 'proprietorship' && !currentCompany.name) currentCompany.name = currentCompany.proprietor;
    bootstrap.Modal.getInstance(document.getElementById('newCompanyModal')).hide();
    document.getElementById('dash-comp-name').innerText = currentCompany.name;
    document.getElementById('dash-comp-prop').innerText = `Entity Detail: ${currentCompany.proprietor}`;
    document.getElementById('dash-years-container').innerHTML = '';
    window.switchView('view-dashboard');
}

window.openNewYearModal = function() {
    const sel = document.getElementById('importYearSelect');
    sel.innerHTML = '<option value="none">Start Fresh (No Import)</option>';
    currentCompany.availableYears.forEach(y => sel.innerHTML += `<option value="${y}">Import from ${y}</option>`);
    new bootstrap.Modal(document.getElementById('addYearModal')).show();
}

window.handleImportSelect = function() {
    let val = document.getElementById('importYearSelect').value;
    if(val !== 'none') {
        let match = val.match(/(\d{4})-(\d{2})/);
        if(match) {
            let y1 = parseInt(match[1]) + 1;
            let y2 = parseInt(match[2]) + 1;
            let newYr = `${y1}-${y2.toString().padStart(2, '0')}`;
            document.getElementById('newYear').value = newYr;
            document.getElementById('newYearEnd').value = `31-03-${y1+1}`;
        }
    }
}

window.loadYearData = async function(yr) {
    showLoader(`Loading ${yr}...`);
    try {
        const data = await secureFetch(`action=getCompanyData&companyId=${currentCompany.id}&year=${yr}`);
        currentCompany.year = yr;
        
        let incomingFinData = data.finData || data; 
        let incomingSettings = incomingFinData.settings || data.settings || {};
        let incomingConfig = incomingFinData.config || data.config || {};

        currentCompany.yearEnd = incomingSettings.yearEnd || '31-03';
        finData = resetFinData(false);
        
        const arrKeys = ['openingStock', 'purchases', 'sales', 'closingStock', 'directExpenses', 'directIncomes', 'indirectExpenses', 'indirectIncomes', 'fixedAssets', 'bankBalance', 'receivables', 'partners', 'loansAdvancesAsset', 'currentAssets', 'otherCurrentAssets', 'loansAdvancesLiab', 'currentLiabilities', 'otherCurrentLiabilities'];
        arrKeys.forEach(k => { if(incomingFinData[k]) finData[k] = JSON.parse(JSON.stringify(incomingFinData[k])); });

        finData.settings = incomingSettings;
        finData.config = incomingConfig;

        document.getElementById('businessType').value = incomingSettings.businessType || 'proprietorship';
        document.getElementById('tradingMode').value = incomingSettings.tradingMode || 'single';
        document.getElementById('trdBal').value = incomingSettings.trdBal || 'gp';
        document.getElementById('trdTarget').value = incomingSettings.trdTarget || 0;
        document.getElementById('trdAutoName').value = incomingSettings.trdAutoName || 'Balancing Figure';
        document.getElementById('pnlBal').value = incomingSettings.pnlBal || 'np';
        document.getElementById('pnlTarget').value = incomingSettings.pnlTarget || 0;
        document.getElementById('pnlAutoName').value = incomingSettings.pnlAutoName || 'Misc. Entry';
        document.getElementById('reportDate').value = incomingSettings.reportDate || '';
        document.getElementById('reportPlace').value = incomingSettings.reportPlace || '';
        
        document.getElementById('sig1Name').value = incomingSettings.sig1Name || '';
        document.getElementById('sig1Title').value = incomingSettings.sig1Title || '';
        document.getElementById('sig2Name').value = incomingSettings.sig2Name || '';
        document.getElementById('sig2Title').value = incomingSettings.sig2Title || '';
        
        document.getElementById('capOpening').value = incomingSettings.capOpening || 0;
        document.getElementById('capAdditional').value = incomingSettings.capAdditional || 0;
        document.getElementById('capDrawings').value = incomingSettings.capDrawings || 0;
        
        cashBalanceVal = parseFloat(incomingSettings.cashBalance) || 0;
        document.getElementById('cashBalance').value = cashBalanceVal;

        if(document.getElementById('padPnl')) document.getElementById('padPnl').value = incomingConfig.padPnl ?? 5;
        if(document.getElementById('padBS')) document.getElementById('padBS').value = incomingConfig.padBS ?? 0;

        if(document.getElementById('schCurrentAssets')) document.getElementById('schCurrentAssets').checked = incomingConfig.schCA || false;
        if(document.getElementById('schCurrentLiab')) document.getElementById('schCurrentLiab').checked = incomingConfig.schCL || false;
        if(document.getElementById('schLoansAsset')) document.getElementById('schLoansAsset').checked = incomingConfig.schLAA || false;
        if(document.getElementById('schLoansLiab')) document.getElementById('schLoansLiab').checked = incomingConfig.schLAL || false;
        if(document.getElementById('schZeroAdd')) document.getElementById('schZeroAdd').checked = incomingConfig.schZeroAdd || false;
        if(document.getElementById('schFaSub')) document.getElementById('schFaSub').checked = incomingConfig.schFaSub || false;
        if(document.getElementById('schFA')) document.getElementById('schFA').checked = incomingConfig.schFA || false;
        if(document.getElementById('schDebtors')) document.getElementById('schDebtors').checked = incomingConfig.schDebtors || false;
        if(document.getElementById('schBank')) document.getElementById('schBank').checked = incomingConfig.schBank || false;
        if(document.getElementById('schPartners')) document.getElementById('schPartners').checked = incomingConfig.schPartners || false;

        window.updateEntityLogic();
        window.updateBalancingUI();
        startWizard();
    } catch(e) { console.error(e); }
    hideLoader();
}

window.createNewYear = async function() {
    const newYr = document.getElementById('newYear').value;
    const newEnd = document.getElementById('newYearEnd').value;
    const impYr = document.getElementById('importYearSelect').value;
    
    bootstrap.Modal.getInstance(document.getElementById('addYearModal')).hide();
    currentCompany.year = newYr; currentCompany.yearEnd = newEnd;
    
    if (impYr === 'none') {
        resetFinData(true);
        window.updateEntityLogic();
        window.updateBalancingUI();
        startWizard();
    } else {
        showLoader(`Importing...`);
        try {
            const data = await secureFetch(`action=getCompanyData&companyId=${currentCompany.id}&year=${impYr}`);
            
            let oldData = data.finData || data;
            let oldSettings = oldData.settings || data.settings || {};
            
            resetFinData(false); 
            document.getElementById('businessType').value = oldSettings.businessType || 'proprietorship';
            document.getElementById('tradingMode').value = oldSettings.tradingMode || 'single';
            document.getElementById('trdBal').value = oldSettings.trdBal || 'gp';
            document.getElementById('pnlBal').value = oldSettings.pnlBal || 'np';
            
            if(oldData.fixedAssets) {
                finData.fixedAssets = oldData.fixedAssets.map(a => {
                    let base = (parseFloat(a.opening)||0) + (parseFloat(a.addition)||0);
                    let wdv = base - (a.depreciable ? Math.round(base * ((parseFloat(a.rate)||0)/100)) : 0);
                    return { name: a.name, opening: wdv, addition: 0, amount: wdv, rate: a.rate, depreciable: a.depreciable };
                });
            }
            
            if (oldSettings.businessType === 'proprietorship') {
                let eMath = computeEngineMath(oldData, oldSettings);
                let oldCap = (parseFloat(oldSettings.capOpening) || 0) + (parseFloat(oldSettings.capAdditional) || 0) + eMath.autoTargetNP - (parseFloat(oldSettings.capDrawings) || 0);
                document.getElementById('capOpening').value = oldCap;
                document.getElementById('trdTarget').value = 0; document.getElementById('pnlTarget').value = 0; 
                document.getElementById('capAdditional').value = 0; document.getElementById('capDrawings').value = 0;
            } else {
                if(oldData.partners) {
                    let eMath = computeEngineMath(oldData, oldSettings);
                    let calc = allocatePartnerCapital(oldData.partners, eMath.autoTargetNP);
                    finData.partners = oldData.partners.map((p, idx) => {
                        return { name: p.name, opening: p.closingBal, addCap: 0, remun: 0, intCap: 0, draw: 0, ratio: p.ratio };
                    });
                }
            }

            if(oldData.closingStock) finData.openingStock = JSON.parse(JSON.stringify(oldData.closingStock));
            
            ['receivables', 'bankBalance', 'currentAssets', 'otherCurrentLiabilities', 'loansAdvancesAsset', 'loansAdvancesLiab', 'currentLiabilities'].forEach(cat => {
                finData[cat] = oldData[cat] ? JSON.parse(JSON.stringify(oldData[cat])) : [];
            });
            
            ['directExpenses', 'directIncomes', 'indirectExpenses', 'indirectIncomes'].forEach(cat => {
                finData[cat] = oldData[cat] ? oldData[cat].map(i => ({...i, amount: 0})) : [];
            });
            
            cashBalanceVal = parseFloat(oldSettings.cashBalance) || 0;
            document.getElementById('cashBalance').value = cashBalanceVal;
            
            window.updateEntityLogic();
            window.updateBalancingUI();
            startWizard();
        } catch(e) { console.error(e); }
        hideLoader();
    }
}

window.saveToCloud = async function() {
    showLoader("Saving...");
    cashBalanceVal = parseFloat(document.getElementById('cashBalance').value) || 0;
    
    finData.settings = { 
        reportDate: document.getElementById('reportDate').value, reportPlace: document.getElementById('reportPlace').value,
        sig1Name: document.getElementById('sig1Name').value, sig1Title: document.getElementById('sig1Title').value,
        sig2Name: document.getElementById('sig2Name').value, sig2Title: document.getElementById('sig2Title').value,
        businessType: document.getElementById('businessType').value,
        tradingMode: document.getElementById('tradingMode').value,
        trdBal: document.getElementById('trdBal').value, trdTarget: Number(document.getElementById('trdTarget').value), trdAutoName: document.getElementById('trdAutoName').value,
        pnlBal: document.getElementById('pnlBal').value, pnlTarget: Number(document.getElementById('pnlTarget').value), pnlAutoName: document.getElementById('pnlAutoName').value,
        capOpening: Number(document.getElementById('capOpening').value), capAdditional: Number(document.getElementById('capAdditional').value),
        capDrawings: Number(document.getElementById('capDrawings').value), cashBalance: cashBalanceVal, yearEnd: currentCompany.yearEnd
    };

    finData.config = {
        schCA: document.getElementById('schCurrentAssets')?.checked || false, schCL: document.getElementById('schCurrentLiab')?.checked || false,
        schLAA: document.getElementById('schLoansAsset')?.checked || false, schLAL: document.getElementById('schLoansLiab')?.checked || false,
        schZeroAdd: document.getElementById('schZeroAdd')?.checked || false, schFaSub: document.getElementById('schFaSub')?.checked || false,
        schFA: document.getElementById('schFA')?.checked || false, schDebtors: document.getElementById('schDebtors')?.checked || false, schBank: document.getElementById('schBank')?.checked || false,
        schPartners: document.getElementById('schPartners')?.checked || false,
        padPnl: document.getElementById('padPnl')?.value || 5,
        padBS: document.getElementById('padBS')?.value || 0
    };
    
    let token = sessionStorage.getItem('authToken');
    const payload = { action: 'saveData', sessionToken: token, companyId: currentCompany.id, companyName: currentCompany.name, proprietor: currentCompany.proprietor, year: currentCompany.year, finData: finData };
    
    try {
        let res = await fetch(weburl, { method: 'POST', body: JSON.stringify(payload) });
        let data = await res.json();
        
        if (data.status === 'error' && data.message === 'unauthorized') {
            throw new Error("Unauthorized");
        }

        if(!currentCompany.availableYears.includes(currentCompany.year)) currentCompany.availableYears.push(currentCompany.year);
        isDirty = false;
        hideLoader(); customAlert("Database saved successfully!");
    } catch(e) { 
        hideLoader(); 
        if(e.message === "Unauthorized") {
            sessionStorage.removeItem('authToken');
            document.getElementById('auth-screen').classList.remove('d-none');
            document.getElementById('authMsg').className = "text-danger small fw-bold mt-2";
            document.getElementById('authMsg').innerText = "Session expired. Please log in again.";
        } else {
            customAlert("Failed to save."); 
        }
    }
}

function resetFinData(clearInputs = true) {
    for(let k in finData) { if(k!=='settings' && k!=='config') finData[k] = []; }
    if(clearInputs) {
        document.getElementById('trdTarget').value = 0; document.getElementById('pnlTarget').value = 0;
        document.getElementById('capOpening').value = 0; document.getElementById('capAdditional').value = 0; document.getElementById('capDrawings').value = 0; 
        document.getElementById('cashBalance').value = 0; document.getElementById('trdAutoName').value = 'Balancing Figure'; document.getElementById('pnlAutoName').value = 'Misc. Entry';
        document.getElementById('reportDate').value = ''; document.getElementById('reportPlace').value = ''; 
        document.getElementById('sig1Name').value = ''; document.getElementById('sig1Title').value = ''; document.getElementById('sig2Name').value = ''; document.getElementById('sig2Title').value = '';
        
        const checks = ['schCurrentAssets', 'schCurrentLiab', 'schLoansAsset', 'schLoansLiab', 'schZeroAdd', 'schFaSub', 'schFA', 'schDebtors', 'schBank', 'schPartners'];
        checks.forEach(id => { if(document.getElementById(id)) document.getElementById(id).checked = false; });
        if(document.getElementById('padPnl')) document.getElementById('padPnl').value = 5;
        if(document.getElementById('padBS')) document.getElementById('padBS').value = 0;
    }
    return finData;
}

// --- WIZARD LOGIC ---
window.updateCash = function(val) { cashBalanceVal = parseFloat(val) || 0; window.markDirty(); }

window.updateBalancingUI = function() {
    let trdBal = document.getElementById('trdBal').value;
    document.getElementById('trdTarget').disabled = (trdBal === 'gp');
    document.getElementById('trdAutoName').disabled = (trdBal === 'gp');

    let pnlBal = document.getElementById('pnlBal').value;
    document.getElementById('pnlTarget').disabled = (pnlBal === 'np');
    document.getElementById('pnlAutoName').disabled = (pnlBal === 'np');
    window.markDirty();
}

window.updateTradingMode = function() { window.markDirty(); window.buildAllAccordions(); }

window.updateEntityLogic = function() {
    let bType = document.getElementById('businessType').value;
    let sTitle = document.getElementById('sig1Title');
    if(!sTitle.value) {
        if(bType === 'proprietorship') sTitle.value = 'Proprietor';
        else if(bType === 'partnership') sTitle.value = 'Partner';
        else sTitle.value = 'Director';
    }

    let propDiv = document.getElementById('capitalProprietorDiv');
    let partDiv = document.getElementById('capitalPartnerDiv');
    let navStep4 = document.getElementById('nav-step-4');
    let wrapSchPart = document.getElementById('wrapper-schPartners');

    if(bType === 'proprietorship') {
        if(propDiv) propDiv.classList.remove('d-none');
        if(partDiv) partDiv.classList.add('d-none');
        if(navStep4) navStep4.innerText = '4. Capital Account';
        if(wrapSchPart) wrapSchPart.style.display = 'none';
    } else {
        if(propDiv) propDiv.classList.add('d-none');
        if(partDiv) partDiv.classList.remove('d-none');
        if(navStep4) navStep4.innerText = '4. Partners / Directors';
        if(wrapSchPart) wrapSchPart.style.display = 'flex';
    }
    window.buildAllAccordions();
}

function startWizard() {
    document.getElementById('wizard-company-name').innerText = `${currentCompany.name} (FY: ${currentCompany.year})`;
    currentStep = 1; isDirty = false; window.jumpToStep(1); window.calcLiveTally(); window.switchView('view-wizard');
}

window.calcLiveTally = function() {
    finData.settings.trdBal = document.getElementById('trdBal').value;
    finData.settings.trdTarget = Number(document.getElementById('trdTarget').value);
    finData.settings.trdAutoName = document.getElementById('trdAutoName').value;
    finData.settings.pnlBal = document.getElementById('pnlBal').value;
    finData.settings.pnlTarget = Number(document.getElementById('pnlTarget').value);
    finData.settings.pnlAutoName = document.getElementById('pnlAutoName').value;

    let eMath = computeEngineMath(finData, finData.settings);
    const bType = document.getElementById('businessType').value;

    let closingCap = 0;
    if(bType === 'proprietorship') {
        let capOp = parseFloat(document.getElementById('capOpening').value) || 0;
        let capAdd = parseFloat(document.getElementById('capAdditional').value) || 0;
        let capDrw = parseFloat(document.getElementById('capDrawings').value) || 0;
        closingCap = capOp + capAdd + eMath.autoTargetNP - capDrw;
    } else {
        let pCalc = allocatePartnerCapital(finData.partners, eMath.autoTargetNP);
        closingCap = pCalc.closingCap;
    }

    const sum = (arr) => arr.reduce((a, b) => a + (parseFloat(b.amount)||0), 0);
    let liabilities = closingCap + sum(finData.loansAdvancesLiab) + sum(finData.currentLiabilities) + sum(finData.otherCurrentLiabilities);
    
    let wdvAssets = 0;
    eMath.pAssets.forEach(a => wdvAssets += a.amount);
    
    let clStock = eMath.hasTrading ? eMath.vClStock : 0; 
    let assets = wdvAssets + clStock + sum(finData.receivables) + cashBalanceVal + sum(finData.bankBalance) + sum(finData.currentAssets) + sum(finData.loansAdvancesAsset);
    
    let diff = Math.round((liabilities - assets) * 100) / 100;
    const badgeDesktop = document.getElementById('liveTallyBadge');
    const badgeMobile = document.getElementById('mobileTallyBadge');
    
    let str = ''; let cls = '';
    if (diff === 0) { cls = 'badge bg-success shadow-sm border border-dark'; str = '✅ Tally: Perfect';
    } else { cls = 'badge bg-danger shadow-sm border border-dark'; str = `⚠️ Diff: ₹ ${fmt(Math.abs(diff))}`; }
    
    if(badgeDesktop) { badgeDesktop.className = cls + ' fs-6 mt-3 p-2 w-100 rounded-pill d-none d-md-block'; badgeDesktop.innerText = str; }
    if(badgeMobile) { badgeMobile.className = cls + ' fs-7 p-2 rounded-pill d-md-none'; badgeMobile.innerText = str; }
}

window.updateSingleCat = function(catId, val) {
    window.markDirty();
    let amount = parseFloat(val) || 0;
    let title = categories.find(c => c.id === catId).title;
    finData[catId] = [{ name: title, amount: amount }];
}

window.buildAllAccordions = function() {
    const isService = window.getIsService();
    const tMode = document.getElementById('tradingMode') ? document.getElementById('tradingMode').value : 'single';
    const step2Title = document.getElementById('step-2-title');
    
    if(step2Title) step2Title.innerText = isService ? '2. Gross Receipts & Direct Exp.' : '2. Trading Account Inputs';

    const step2Container = document.getElementById(`accordion-step-2`);
    if(step2Container) {
        step2Container.innerHTML = '';
        let step2Cats = categories.filter(c => c.step === 2);

        step2Cats.forEach(cat => {
            let isSingleTrd = (tMode === 'single') && ['openingStock', 'purchases', 'sales', 'closingStock'].includes(cat.id);
            
            if (isSingleTrd) {
                let currentVal = finData[cat.id].length > 0 ? finData[cat.id][0].amount : '';
                let titleStr = (cat.id === 'sales' && isService) ? 'Gross Receipts' : cat.title;
                step2Container.innerHTML += `
                    <div class="mb-3 p-3 bg-white border border-info rounded-3 shadow-sm">
                        <label class="fw-bold mb-1 text-primary">${titleStr}</label>
                        <input type="number" class="form-control fw-bold" placeholder="Total Amount" value="${currentVal}" oninput="window.updateSingleCat('${cat.id}', this.value)">
                    </div>`;
            } else {
                let lbl = cat.id === 'sales' && isService ? 'Receipt Source' : 'Name';
                let inputFields = `
                   <div class="col-5"><input type="text" id="name-${cat.id}" class="form-control form-control-sm" placeholder="${lbl}"></div>
                   <div class="col-5"><input type="number" id="amt-${cat.id}" class="form-control form-control-sm" placeholder="Amount"></div>
                   <div class="col-2"><button class="btn btn-sm btn-primary w-100 fw-bold" onclick="window.addItem('${cat.id}')">+</button></div>`;
                
                let titleStr = (cat.id === 'sales' && isService) ? 'Gross Receipts' : cat.title;

                step2Container.innerHTML += `
                    <div class="accordion-item" id="cat-wrap-${cat.id}">
                        <h2 class="accordion-header"><button class="accordion-button collapsed py-2 fw-bold" type="button" data-bs-toggle="collapse" data-bs-target="#col-${cat.id}">
                            ${titleStr} <span class="badge bg-secondary ms-2 rounded-pill" id="badge-${cat.id}">0</span>
                        </button></h2>
                        <div id="col-${cat.id}" class="accordion-collapse collapse" data-bs-parent="#accordion-step-2">
                            <div class="accordion-body p-2"><div id="list-${cat.id}" class="mb-2"></div><div class="row g-1 border-top pt-2">${inputFields}</div></div>
                        </div>
                    </div>`;
            }
        });
    }

    [3, 4, 5, 6, 7, 8, 9, 10].forEach(stepNum => {
        const container = document.getElementById(`accordion-step-${stepNum}`);
        if(!container) return;
        container.innerHTML = '';
        let stepCats = categories.filter(c => c.step === stepNum);
        
        stepCats.forEach(cat => {
            let inputFields = '';
            if(cat.id === 'fixedAssets') {
                inputFields = `
                   <div class="col-12 mb-1"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="depr-${cat.id}" checked onchange="window.toggleDeprInput('${cat.id}')"><label class="form-check-label text-sm fw-bold">Is Depreciable Asset?</label></div></div>
                   <div class="col-3"><input type="text" id="name-${cat.id}" class="form-control form-control-sm" placeholder="Asset Name"></div>
                   <div class="col-3"><input type="number" id="op-${cat.id}" class="form-control form-control-sm" placeholder="Opening Bal"></div>
                   <div class="col-2"><input type="number" id="add-${cat.id}" class="form-control form-control-sm" placeholder="+ Additions"></div>
                   <div class="col-2"><input type="number" id="rate-${cat.id}" class="form-control form-control-sm" placeholder="Rate %"></div>
                   <div class="col-2"><button class="btn btn-sm btn-primary w-100 fw-bold" onclick="window.addItem('${cat.id}')">+</button></div>`;
            } else if (cat.isPartner) {
                inputFields = `
                   <div class="col-2"><input type="text" id="name-${cat.id}" class="form-control form-control-sm px-1" placeholder="Name"></div>
                   <div class="col-2"><input type="number" id="op-${cat.id}" class="form-control form-control-sm px-1" placeholder="Opening"></div>
                   <div class="col-2"><input type="number" id="addCap-${cat.id}" class="form-control form-control-sm px-1" placeholder="+ Add Cap"></div>
                   <div class="col-1"><input type="number" id="remun-${cat.id}" class="form-control form-control-sm px-1" placeholder="Salary"></div>
                   <div class="col-1"><input type="number" id="intCap-${cat.id}" class="form-control form-control-sm px-1" placeholder="Int.Cap"></div>
                   <div class="col-1"><input type="number" id="draw-${cat.id}" class="form-control form-control-sm px-1" placeholder="-Draw"></div>
                   <div class="col-1"><input type="number" id="ratio-${cat.id}" class="form-control form-control-sm px-1" placeholder="Ratio"></div>
                   <div class="col-2"><button class="btn btn-sm btn-primary w-100 fw-bold" onclick="window.addItem('${cat.id}')">+</button></div>`;
            } else {
                inputFields = `
                   <div class="col-5"><input type="text" id="name-${cat.id}" class="form-control form-control-sm" placeholder="Name"></div>
                   <div class="col-5"><input type="number" id="amt-${cat.id}" class="form-control form-control-sm" placeholder="Amount"></div>
                   <div class="col-2"><button class="btn btn-sm btn-primary w-100 fw-bold" onclick="window.addItem('${cat.id}')">+</button></div>`;
            }

            container.innerHTML += `
                <div class="accordion-item" id="cat-wrap-${cat.id}">
                    <h2 class="accordion-header"><button class="accordion-button collapsed py-2 fw-bold" type="button" data-bs-toggle="collapse" data-bs-target="#col-${cat.id}">
                        ${cat.title} <span class="badge bg-secondary ms-2 rounded-pill" id="badge-${cat.id}">0</span>
                    </button></h2>
                    <div id="col-${cat.id}" class="accordion-collapse collapse" data-bs-parent="#accordion-step-${stepNum}">
                        <div class="accordion-body p-2"><div id="list-${cat.id}" class="mb-2"></div><div class="row g-1 border-top pt-2">${inputFields}</div></div>
                    </div>
                </div>`;
        });
    });
    refreshAllLists();
}

window.toggleDeprInput = function(catId) {
    let isDepr = document.getElementById(`depr-${catId}`).checked;
    let rateInput = document.getElementById(`rate-${catId}`);
    if(!isDepr) { rateInput.value = ''; rateInput.disabled = true; } 
    else { rateInput.disabled = false; }
}

window.addItem = function(catId) {
    window.markDirty();
    let nameRaw = document.getElementById(`name-${catId}`).value.trim();
    const name = capitalize(nameRaw) || 'Item';
    const cat = categories.find(c => c.id === catId);
    let item = { name };
    
    if (catId === 'fixedAssets') {
        item.depreciable = document.getElementById(`depr-${catId}`).checked;
        item.opening = parseFloat(document.getElementById(`op-${catId}`).value) || 0;
        item.addition = parseFloat(document.getElementById(`add-${catId}`).value) || 0;
        item.rate = item.depreciable ? (parseFloat(document.getElementById(`rate-${catId}`).value) || 0) : 0;
        document.getElementById(`op-${catId}`).value = ''; document.getElementById(`add-${catId}`).value = '';
        document.getElementById(`rate-${catId}`).value = '';
    } else if (cat.isPartner) {
        item.opening = parseFloat(document.getElementById(`op-${catId}`).value) || 0;
        item.addCap = parseFloat(document.getElementById(`addCap-${catId}`).value) || 0;
        item.remun = parseFloat(document.getElementById(`remun-${catId}`).value) || 0;
        item.intCap = parseFloat(document.getElementById(`intCap-${catId}`).value) || 0;
        item.draw = parseFloat(document.getElementById(`draw-${catId}`).value) || 0;
        item.ratio = parseFloat(document.getElementById(`ratio-${catId}`).value) || 1;
        document.getElementById(`op-${catId}`).value = ''; document.getElementById(`addCap-${catId}`).value = '';
        document.getElementById(`remun-${catId}`).value = ''; document.getElementById(`intCap-${catId}`).value = ''; 
        document.getElementById(`draw-${catId}`).value = ''; document.getElementById(`ratio-${catId}`).value = '';
    } else {
        item.amount = parseFloat(document.getElementById(`amt-${catId}`).value) || 0;
        document.getElementById(`amt-${catId}`).value = '';
    }
    
    document.getElementById(`name-${catId}`).value = '';
    finData[catId].push(item);
    refreshList(catId);
}

window.editItem = function(catId, index) {
    let item = finData[catId][index];
    let cat = categories.find(c => c.id === catId);
    
    document.getElementById(`name-${catId}`).value = item.name;
    
    if (catId === 'fixedAssets') {
        document.getElementById(`depr-${catId}`).checked = item.depreciable;
        window.toggleDeprInput(catId);
        document.getElementById(`op-${catId}`).value = item.opening;
        document.getElementById(`add-${catId}`).value = item.addition;
        document.getElementById(`rate-${catId}`).value = item.rate;
    } else if (cat.isPartner) {
        document.getElementById(`op-${catId}`).value = item.opening;
        document.getElementById(`addCap-${catId}`).value = item.addCap || 0;
        document.getElementById(`remun-${catId}`).value = item.remun;
        document.getElementById(`intCap-${catId}`).value = item.intCap;
        document.getElementById(`draw-${catId}`).value = item.draw;
        document.getElementById(`ratio-${catId}`).value = item.ratio;
    } else {
        document.getElementById(`amt-${catId}`).value = item.amount;
    }
    
    window.removeItem(catId, index);
}

window.removeItem = function(catId, index) { window.markDirty(); finData[catId].splice(index, 1); refreshList(catId); }

function refreshList(catId) {
    const container = document.getElementById(`list-${catId}`);
    if (!container) return;
    container.innerHTML = '';
    finData[catId].forEach((item, idx) => {
        let textStr = ''; let displayVal = 0;
        if (catId === 'fixedAssets') {
            displayVal = (parseFloat(item.opening)||0) + (parseFloat(item.addition)||0);
            textStr = `${item.name} (Op: ${fmt(item.opening)}, Add: ${fmt(item.addition||0)}, ${item.depreciable ? item.rate+'%' : 'Non-Depr'})`;
        } else if (catId === 'partners') {
            displayVal = item.opening;
            textStr = `${item.name} (Ratio: ${item.ratio}, Remun: ${fmt(item.remun)})`;
        } else {
            textStr = item.name;
            displayVal = item.amount;
        }
        container.innerHTML += `<div class="d-flex justify-content-between text-sm mb-1 border-bottom pb-1 align-items-center">
            <span class="fw-bold">${textStr}</span>
            <div class="d-flex align-items-center">
                <span class="me-2 amount fw-bold text-primary">${fmt(displayVal)}</span> 
                <button class="btn btn-sm btn-outline-secondary py-0 px-2 rounded-pill me-1" onclick="window.editItem('${catId}', ${idx})">Edit</button>
                <button class="btn btn-sm btn-outline-danger py-0 px-2 rounded-pill" onclick="window.removeItem('${catId}', ${idx})">&times;</button>
            </div>
        </div>`;
    });
    const b = document.getElementById(`badge-${catId}`);
    if(b) b.innerText = finData[catId].length;
    window.calcLiveTally(); 
}
function refreshAllLists() { categories.forEach(c => refreshList(c.id)); window.calcLiveTally(); }

window.toggleTheme = function(val) { 
    let theme = val || 'blue';
    document.body.className = `bg-light theme-${theme}`;
    document.querySelectorAll('.theme-selector').forEach(sel => sel.value = theme);
}

window.toggleGrid = function(show) {
    let tbls = document.querySelectorAll('#reportContainer .fin-table, #projReportContainer .fin-table');
    tbls.forEach(t => show ? t.classList.remove('no-grid') : t.classList.add('no-grid'));
}

// --- REPORT GENERATION ENGINE ---
function flattenFourColBlock(block, prefix) {
    if(block.isBlank) return [{ text: '', amount: '', isBlank: true }];
    if(!block || block.total === undefined || block.total === '') return [];
    if(block.total === 0 && !block.forceItems && !block.bold) return []; 

    let rows = [];
    let hasItems = block.items && block.items.length > 0;
    let isSingleItem = hasItems && block.items.length === 1 && !block.forceItems;

    if (!hasItems || isSingleItem) {
        let title = block.title;
        if (isSingleItem && !block.cleanTitle && block.items[0].name && block.items[0].name.toLowerCase() !== 'item' && block.items[0].name.toLowerCase() !== title.toLowerCase()) {
            title += ` - ${block.items[0].name}`;
        }
        let fullTitle = prefix && block.title !== '&nbsp;' ? `${prefix} ${title}` : title;
        rows.push({ text: fullTitle, amount: block.total, bold: block.bold, noUpper: block.noUpper });
    } else {
        if (!block.hideHeader) {
            rows.push({ text: block.title, bold: true, isGroupHeader: true, noUpper: block.noUpper }); 
        }
        block.items.forEach((item) => {
            let itemName = `${prefix ? prefix + ' ' : ''}${item.name}`;
            rows.push({ text: itemName, amount: item.amount, indent: !block.hideHeader, noUpper: block.noUpper });
        });
    }
    return rows;
}

function buildFourColumnContinuousTable(sections, hDr = "Particulars", hCr = "Particulars", customClass = "") {
    let html = `<table class="fin-table table-4col ${customClass}">
        <thead><tr><th>${hDr}</th><th>Amount</th><th>${hCr}</th><th>Amount</th></tr></thead><tbody>`;
        
    sections.forEach((sec, sIdx) => {
        let drRows = []; sec.drArr.forEach(b => drRows = drRows.concat(flattenFourColBlock(b, 'To')));
        let crRows = []; sec.crArr.forEach(b => crRows = crRows.concat(flattenFourColBlock(b, 'By')));
        let max = Math.max(drRows.length, crRows.length);
        
        for(let i=0; i<max; i++) {
            let d = drRows[i] || {}; let c = crRows[i] || {};
            const renderCell = (cell) => {
                if(cell.isBlank) return `<td><div>&nbsp;</div></td><td></td>`;
                if(!cell.text) return `<td></td><td></td>`;
                let classes = `ac-line ${cell.bold ? 'fw-bold' : ''} ${cell.indent ? 'item-name' : ''} ${cell.isGroupHeader ? 'group-hdr' : ''} ${cell.noUpper ? 'no-upper' : ''}`;
                return `<td><div class="${classes}">${cell.text}</div></td>
                        <td class="amount ${cell.bold ? 'fw-bold' : ''}">${cell.amount !== undefined && cell.amount !== '' ? fmt(cell.amount) : ''}</td>`;
            };
            html += `<tr>${renderCell(d)}${renderCell(c)}</tr>`;
        }
        
        let borderCls = (sIdx === sections.length - 1) ? 'grand-border' : 'total-border';
        html += `<tr class="${borderCls}">
            <td><div class="ac-line bold ps-2">TOTAL</div></td><td class="bold amount">${fmt(sec.total)}</td>
            <td><div class="ac-line bold ps-2">TOTAL</div></td><td class="bold amount">${fmt(sec.total)}</td>
        </tr>`;
    });
    
    html += `</tbody></table>`;
    return html;
}

function flattenInnerOuterBlock(block, prefix) {
    if(block.isBlank) return [{ text: '', outer: '', isBlank: true }];
    if(!block || block.total === undefined) return [];
    if(block.total === 0 && !block.forceItems && !block.bold) return []; 

    let rows = [];
    let hasItems = block.items && block.items.length > 0;
    let isSingleItem = hasItems && block.items.length === 1 && !block.forceItems;

    if (!hasItems || isSingleItem) {
        let title = block.title;
        if (isSingleItem && !block.cleanTitle && block.items[0].name && block.items[0].name.toLowerCase() !== 'item' && block.items[0].name.toLowerCase() !== title.toLowerCase()) {
            title += ` - ${block.items[0].name}`;
        }
        let fullTitle = prefix ? `${prefix} ${title}` : title;
        rows.push({ text: fullTitle, outer: block.total, bold: block.bold });
    } else {
        let fullTitle = prefix ? `${prefix} ${block.title}` : block.title;
        rows.push({ text: fullTitle, bold: true, underline: true }); 
        
        block.items.forEach((item, idx) => {
            let isLastItemInGroup = (idx === block.items.length - 1);
            
            if (item.details && item.details.length > 0) {
                rows.push({ text: `${item.name}`, indent: true }); 
                item.details.forEach((d, dIdx) => {
                    let isLastDetail = (dIdx === item.details.length - 1);
                    let row = { text: d.label, inner: d.val, subIndent: true };
                    if (isLastDetail) row.outer = item.amount;
                    rows.push(row);
                });
            } else {
                let row = { text: `${item.name}`, inner: item.amount, indent: true };
                if (isLastItemInGroup) row.outer = block.total;
                rows.push(row);
            }
        });
    }
    return rows;
}

function buildInnerOuterTable(drArr, crArr, total, hDr = "Particulars", hCr = "Particulars", customClass = "") {
    let drRows = []; drArr.forEach(b => drRows = drRows.concat(flattenInnerOuterBlock(b, hDr==="Liabilities"?'':'To')));
    let crRows = []; crArr.forEach(b => crRows = crRows.concat(flattenInnerOuterBlock(b, hCr==="Assets"?'':'By')));
    let max = Math.max(drRows.length, crRows.length);
    
    let html = `<table class="fin-table table-6col inner-outer-table ${customClass}">
        <thead><tr><th>${hDr}</th><th>Amount</th><th>Amount</th><th>${hCr}</th><th>Amount</th><th>Amount</th></tr></thead><tbody>`;
        
    for(let i=0; i<max; i++) {
        let d = drRows[i] || {}; let c = crRows[i] || {};
        const renderCell = (cell) => {
            if(cell.isBlank) return `<td><div>&nbsp;</div></td><td></td><td></td>`;
            if(!cell.text) return `<td></td><td></td><td></td>`;
            let classes = `ac-line ${cell.bold ? 'fw-bold' : ''} ${cell.indent ? 'item-name' : ''} ${cell.subIndent ? 'sub-item-name' : ''} ${cell.underline ? 'group-hdr' : ''}`;
            let btmBorder = cell.outer !== undefined && cell.inner !== undefined ? 'border-bottom: 1px solid #000;' : ''; 
            return `<td><div class="${classes}">${cell.text}</div></td>
                <td class="amount" style="${btmBorder}">${cell.inner !== undefined && cell.inner !== '' ? fmt(cell.inner) : ''}</td>
                <td class="amount fw-bold">${cell.outer !== undefined && cell.outer !== '' ? fmt(cell.outer) : ''}</td>`;
        };
        html += `<tr>${renderCell(d)}${renderCell(c)}</tr>`;
    }
    html += `</tbody><tfoot class="table-group-divider"><tr class="grand-border">
        <td colspan="2"><div class="ac-line bold ps-2">TOTAL</div></td><td class="bold amount">${fmt(total)}</td>
        <td colspan="2"><div class="ac-line bold ps-2">TOTAL</div></td><td class="bold amount">${fmt(total)}</td>
    </tr></tfoot></table>`;
    return html;
}

function generateSignatureBlock(isProj = false) {
    let rDate = document.getElementById('reportDate').value ? formatDate(document.getElementById('reportDate').value) : '___________________';
    let rPlace = document.getElementById('reportPlace').value ? capitalize(document.getElementById('reportPlace').value) : '___________________';
    
    let s1N = isProj ? window.projBaseData?.settings?.sig1Name : document.getElementById('sig1Name').value;
    let s1T = isProj ? window.projBaseData?.settings?.sig1Title : document.getElementById('sig1Title').value;
    let s2N = isProj ? window.projBaseData?.settings?.sig2Name : document.getElementById('sig2Name').value;
    let s2T = isProj ? window.projBaseData?.settings?.sig2Title : document.getElementById('sig2Title').value;
    let bType = isProj ? (window.projBaseData?.settings?.businessType || 'proprietorship') : document.getElementById('businessType').value;
    
    if(!s1T) s1T = 'Authorized Signatory';
    
    let isCompany = (bType !== 'proprietorship');
    let compNameHTML = isCompany ? `<p class="mb-4 fw-bold text-dark no-upper">For ${currentCompany.name}</p>` : '';

    let sigHTML = `
    <div class="signature-block d-flex justify-content-between align-items-end mt-4">
        <div class="text-start">
            <p class="mb-1 fw-bold text-dark">Date: <span class="fw-normal text-muted">${rDate}</span></p>
            <p class="mb-0 fw-bold text-dark">Place: <span class="fw-normal text-muted">${rPlace}</span></p>
        </div>
        <div class="text-center">
            ${compNameHTML}
            <div class="d-flex gap-5 justify-content-center mt-5">
                <div class="text-center">
                    ${s1N ? `<p class="mb-0 fw-bold text-dark text-uppercase">${s1N}</p>` : ''}
                    <p class="mb-0 fw-bold text-dark text-uppercase">${s1T}</p>
                </div>
                ${s2N || s2T ? `
                <div class="text-center">
                    ${s2N ? `<p class="mb-0 fw-bold text-dark text-uppercase">${s2N}</p>` : ''}
                    ${s2T ? `<p class="mb-0 fw-bold text-dark text-uppercase">${s2T}</p>` : ''}
                </div>` : ''}
            </div>
        </div>
    </div>`;
    return sigHTML;
}

function buildPartnerScheduleMatrix(s) {
    let partners = s.partners || [];
    if(partners.length === 0) return '';
    
    let hasAddCap = partners.some(p => parseFloat(p.addCap) > 0);
    let hasRemun = partners.some(p => parseFloat(p.remun) > 0);
    let hasIntCap = partners.some(p => parseFloat(p.intCap) > 0);
    let hasDraw = partners.some(p => parseFloat(p.draw) > 0);

    let profitTotal = Math.round(partners.reduce((a,b)=>a+(parseFloat(b.profitShare)||0), 0) * 100) / 100;
    let shareLabel = profitTotal >= 0 ? 'Add: Share of Profit' : 'Less: Share of Loss';

    let html = `<div class="schedule-box"><div class="schedule-title">Schedule ${s.num}: ${s.title}</div><div class="table-responsive"><table class="fin-table table-bordered" style="table-layout: auto;"><thead><tr>`;
    
    html += `<th class="text-start" style="width: auto;">Partner Name</th>`;
    html += `<th>Opening Bal.</th>`;
    if (hasAddCap) html += `<th>Add: Capital</th>`;
    if (hasRemun) html += `<th>Remuneration</th>`;
    if (hasIntCap) html += `<th>Int. on Cap.</th>`;
    html += `<th>${shareLabel}</th>`;
    if (hasDraw) html += `<th>Less: Drawings</th>`;
    html += `<th>Closing Bal.</th>`;
    html += `</tr></thead><tbody>`;
    
    let totals = { opening: 0, addCap: 0, remun: 0, intCap: 0, profitShare: 0, draw: 0, closing: 0 };
    
    partners.forEach(p => {
        let op = parseFloat(p.opening) || 0;
        let add = parseFloat(p.addCap) || 0;
        let rem = parseFloat(p.remun) || 0;
        let intC = parseFloat(p.intCap) || 0;
        let pShare = parseFloat(p.profitShare) || 0;
        let drw = parseFloat(p.draw) || 0;
        let cBal = op + add + rem + intC + pShare - drw;

        totals.opening += op;
        totals.addCap += add;
        totals.remun += rem;
        totals.intCap += intC;
        totals.profitShare += pShare;
        totals.draw += drw;
        totals.closing += cBal;

        html += `<tr><td class="text-start fw-bold item-name px-2">${p.name}</td>`;
        html += `<td class="amount px-2">${op !== 0 ? fmt(op) : '-'}</td>`;
        if (hasAddCap) html += `<td class="amount px-2">${add !== 0 ? fmt(add) : '-'}</td>`;
        if (hasRemun) html += `<td class="amount px-2">${rem !== 0 ? fmt(rem) : '-'}</td>`;
        if (hasIntCap) html += `<td class="amount px-2">${intC !== 0 ? fmt(intC) : '-'}</td>`;
        html += `<td class="amount px-2">${pShare !== 0 ? fmt(Math.abs(pShare)) : '-'}</td>`;
        if (hasDraw) html += `<td class="amount px-2">${drw !== 0 ? fmt(drw) : '-'}</td>`;
        html += `<td class="amount fw-bold px-2">${fmt(cBal)}</td></tr>`;
    });

    html += `<tr class="total-border"><td class="text-start fw-bold ps-2">TOTAL</td>`;
    html += `<td class="amount fw-bold px-2">${totals.opening !== 0 ? fmt(totals.opening) : '-'}</td>`;
    if (hasAddCap) html += `<td class="amount fw-bold px-2">${totals.addCap !== 0 ? fmt(totals.addCap) : '-'}</td>`;
    if (hasRemun) html += `<td class="amount fw-bold px-2">${totals.remun !== 0 ? fmt(totals.remun) : '-'}</td>`;
    if (hasIntCap) html += `<td class="amount fw-bold px-2">${totals.intCap !== 0 ? fmt(totals.intCap) : '-'}</td>`;
    html += `<td class="amount fw-bold px-2">${totals.profitShare !== 0 ? fmt(Math.abs(totals.profitShare)) : '-'}</td>`;
    if (hasDraw) html += `<td class="amount fw-bold px-2">${totals.draw !== 0 ? fmt(totals.draw) : '-'}</td>`;
    html += `<td class="amount fw-bold px-2">${fmt(totals.closing)}</td></tr>`;
    
    html += `</tbody></table></div></div>`;
    return html;
}

function buildFAScheduleMatrix(s) {
    let items = s.items || [];
    if(items.length === 0) return '';
    
    let html = `<div class="schedule-box"><div class="schedule-title">Schedule ${s.num}: ${s.title}</div><div class="table-responsive"><table class="fin-table table-bordered"><thead><tr>
        <th class="text-start">Name</th>
        <th>Block</th>
        <th>Opening Balance</th>
        <th>Additions</th>
        <th>Depreciation</th>
        <th>Closing Balance</th>
    </tr></thead><tbody>`;
    
    let tOp=0, tAdd=0, tDep=0, tCl=0;
    
    items.forEach(a => {
        let op = parseFloat(a.opening) || 0;
        let add = parseFloat(a.addition) || 0;
        let dep = parseFloat(a.depr) || 0;
        let cl = parseFloat(a.amount) || 0;
        
        tOp += op; tAdd += add; tDep += dep; tCl += cl;
        
        html += `<tr>
            <td class="text-start item-name px-2">${a.name}</td>
            <td class="text-center px-2">${a.depreciable ? a.rate + '%' : '-'}</td>
            <td class="amount px-2">${op !== 0 ? fmt(op) : '-'}</td>
            <td class="amount px-2">${add !== 0 ? fmt(add) : '-'}</td>
            <td class="amount px-2">${dep !== 0 ? fmt(dep) : '-'}</td>
            <td class="amount fw-bold px-2">${fmt(cl)}</td>
        </tr>`;
    });

    html += `<tr class="total-border">
        <td colspan="2" class="text-start fw-bold ps-2">TOTAL</td>
        <td class="amount fw-bold px-2">${tOp !== 0 ? fmt(tOp) : '-'}</td>
        <td class="amount fw-bold px-2">${tAdd !== 0 ? fmt(tAdd) : '-'}</td>
        <td class="amount fw-bold px-2">${tDep !== 0 ? fmt(tDep) : '-'}</td>
        <td class="amount fw-bold px-2">${fmt(tCl)}</td>
    </tr></tbody></table></div></div>`;
    return html;
}

function buildSchedules(schData) {
    if(schData.length === 0) return '';
    let html = ``;
    
    schData.forEach((s, idx) => {
        let scheduleHeader = '';
        if (idx === 0) {
            scheduleHeader = `<div><h4 class="report-header">${currentCompany.name}</h4><div class="report-title">Schedules forming part of Balance Sheet</div>`;
        }
        
        if(s.isPartnerMatrix) {
            html += `<div class="statement-page">${scheduleHeader}${buildPartnerScheduleMatrix(s)}</div>`;
        } else if (s.isFAMatrix) {
            html += `<div class="statement-page">${scheduleHeader}${buildFAScheduleMatrix(s)}</div>`;
        } else {
            html += `<div class="statement-page">${scheduleHeader}<div class="schedule-box"><div class="schedule-title">Schedule ${s.num}: ${s.title}</div><table class="fin-table table-4col"><tbody>`;
            s.items.forEach(i => {
                html += `<tr><td class="item-name">${i.name}</td><td class="amount">${fmt(i.amount)}</td><td></td><td></td></tr>`;
            });
            html += `<tr class="total-border"><td class="fw-bold ps-2">TOTAL</td><td class="amount fw-bold">${fmt(s.total)}</td><td></td><td></td></tr></tbody></table></div></div>`;
        }
    });
    
    return html;
}

window.generatePreview = function() { window.updateReports(); window.switchView('view-preview'); }

window.updateReports = function() {
    const container = document.getElementById('reportContainer');
    container.innerHTML = '';
    
    finData.settings.trdBal = document.getElementById('trdBal').value;
    finData.settings.trdTarget = Number(document.getElementById('trdTarget').value);
    finData.settings.trdAutoName = document.getElementById('trdAutoName').value;
    finData.settings.pnlBal = document.getElementById('pnlBal').value;
    finData.settings.pnlTarget = Number(document.getElementById('pnlTarget').value);
    finData.settings.pnlAutoName = document.getElementById('pnlAutoName').value;

    let baseData = JSON.parse(JSON.stringify(finData)); 
    let eMath = computeEngineMath(baseData, baseData.settings);
    let baseConfig = baseData.config;
    
    const bType = document.getElementById('businessType').value;
    const isService = !eMath.hasTrading;
    const tMode = document.getElementById('tradingMode').value;
    const forceTrd = (tMode === 'multi');

    let capOp = parseFloat(document.getElementById('capOpening').value) || 0;
    let capAdd = parseFloat(document.getElementById('capAdditional').value) || 0;
    let capDrw = parseFloat(document.getElementById('capDrawings').value) || 0;

    let baseBank = baseData.bankBalance.reduce((a,b)=>a+(parseFloat(b.amount)||0),0);
    let baseRec = baseData.receivables.reduce((a,b)=>a+(parseFloat(b.amount)||0),0);
    let baseLiab = baseData.currentLiabilities.reduce((a,b)=>a+(parseFloat(b.amount)||0),0);

    let titleSuffix = currentCompany.yearEnd ? ` FOR THE YEAR ENDED ${currentCompany.yearEnd}` : '';
    let mainTitle = eMath.hasTrading ? "TRADING AND PROFIT & LOSS A/C" : "PROFIT & LOSS A/C";
    mainTitle += titleSuffix;
    
    let bsTitle = `BALANCE SHEET AS ON ${currentCompany.yearEnd || ''}`;

    let yr = { drTrd: [], crTrd: [], drPnl: [], crPnl: [], drApp: [], crApp: [], liab: [], asset: [] }; 

    if (eMath.hasTrading) {
        if(eMath.pOpStock.length > 0) yr.drTrd.push({ title: 'Opening Stock', items: eMath.pOpStock, total: eMath.vOpStock, forceItems: forceTrd, cleanTitle: true });
        if(eMath.pPur.length > 0) yr.drTrd.push({ title: 'Purchases', items: eMath.pPur, total: eMath.vPur, forceItems: forceTrd, cleanTitle: true });
        eMath.pDirE.forEach(i => yr.drTrd.push({ title: i.name, total: i.amount, forceItems: false }));
        
        if(eMath.pSal.length > 0) yr.crTrd.push({ title: 'Sales', items: eMath.pSal, total: eMath.vSal, forceItems: forceTrd, cleanTitle: true });
        eMath.pDirI.forEach(i => yr.crTrd.push({ title: i.name, total: i.amount, forceItems: false }));
        if(eMath.pClStock.length > 0) yr.crTrd.push({ title: 'Closing Stock', items: eMath.pClStock, total: eMath.vClStock, forceItems: forceTrd, cleanTitle: true });

        if(eMath.gp > 0) yr.drTrd.push({ title: 'Gross Profit c/d', total: eMath.gp, bold: true });
        if(eMath.gl > 0) yr.crTrd.push({ title: 'Gross Loss c/d', total: eMath.gl, bold: true });
    }

    if (eMath.hasTrading) {
        if (eMath.gl > 0) yr.drPnl.push({ title: 'Gross Loss b/d', total: eMath.gl, bold: true });
        if (eMath.gp > 0) yr.crPnl.push({ title: 'Gross Profit b/d', total: eMath.gp, bold: true });
    } else {
        eMath.pDirE.forEach(i => yr.drPnl.push({ title: i.name, total: i.amount, forceItems: false }));
        if (eMath.pSal.length > 0) {
            yr.crPnl.push({ title: 'Gross Receipts', items: eMath.pSal, total: eMath.vSal, forceItems: forceTrd, cleanTitle: true });
        }
        eMath.pDirI.forEach(i => yr.crPnl.push({ title: i.name, total: i.amount, forceItems: false }));
    }

    eMath.pIndE.forEach(i => yr.drPnl.push({ title: i.name, total: i.amount, forceItems: false }));
    if (eMath.tDepr > 0) yr.drPnl.push({ title: 'Depreciation', total: eMath.tDepr, forceItems: false });
    
    eMath.pIndI.forEach(i => yr.crPnl.push({ title: i.name, total: i.amount, forceItems: false }));

    // Apply P&L padding
    let pnlPad = parseInt(baseConfig.padPnl) || 5;
    let pnlDrRows = yr.drPnl.reduce((acc, b) => acc + flattenFourColBlock(b, 'To').length, 0);
    while(pnlDrRows < pnlPad - 1) { yr.drPnl.push({ isBlank: true }); pnlDrRows++; }

    let pnlCrRows = yr.crPnl.reduce((acc, b) => acc + flattenFourColBlock(b, 'By').length, 0);
    while(pnlCrRows < pnlPad - 1) { yr.crPnl.push({ isBlank: true }); pnlCrRows++; }

    let npTitle = (bType === 'proprietorship') ? 'Net Profit transferred to Capital Account' : 'Net Profit c/f';
    let nlTitle = (bType === 'proprietorship') ? 'Net Loss transferred to Capital Account' : 'Net Loss c/f';
    if (eMath.autoTargetNP >= 0) { yr.drPnl.push({ title: npTitle, total: eMath.autoTargetNP, bold: true }); } 
    else { yr.crPnl.push({ title: nlTitle, total: Math.abs(eMath.autoTargetNP), bold: true }); }

    let showApprop = false;
    let pCalc = { remunTotal: 0, intTotal: 0, divProfit: eMath.autoTargetNP, closingCap: 0 };
    
    if(bType !== 'proprietorship') {
        pCalc = allocatePartnerCapital(baseData.partners, eMath.autoTargetNP);
        showApprop = true;

        if(pCalc.remunTotal > 0) yr.drApp.push({ title: 'Partner Remuneration', total: pCalc.remunTotal });
        if(pCalc.intTotal > 0) yr.drApp.push({ title: 'Interest on Capital', total: pCalc.intTotal });
        
        let divTitle = pCalc.divProfit >= 0 ? "Profit transferred to Partners' Capital A/c" : "Loss transferred to Partners' Capital A/c";
        let partnerItems = baseData.partners.map(p => ({name: p.name, amount: Math.abs(p.profitShare)}));

        if (pCalc.divProfit >= 0) { 
            yr.drApp.push({ title: divTitle, items: partnerItems, total: pCalc.divProfit, forceItems: true, cleanTitle: true, noUpper: true }); 
        } else { 
            yr.crApp.push({ title: divTitle, items: partnerItems, total: Math.abs(pCalc.divProfit), forceItems: true, cleanTitle: true, noUpper: true }); 
        }
        
        if (eMath.autoTargetNP >= 0) { yr.crApp.push({ title: 'Net Profit b/d', total: eMath.autoTargetNP, bold: true }); } 
        else { yr.drApp.push({ title: 'Net Loss b/d', total: Math.abs(eMath.autoTargetNP), bold: true }); }
    }

    let closingCap = 0;
    let schedules = []; let schNum = 1;

    if(bType === 'proprietorship') {
        closingCap = capOp + capAdd + eMath.autoTargetNP - capDrw;
        let capItems = [{ name: 'Opening Balance', amount: capOp }];
        if (capAdd > 0) capItems.push({ name: 'Add: Additional Capital', amount: capAdd });
        if (eMath.autoTargetNP >= 0) capItems.push({ name: 'Add: Net Profit', amount: eMath.autoTargetNP });
        else capItems.push({ name: 'Less: Net Loss', amount: Math.abs(eMath.autoTargetNP) });
        if (capDrw > 0) capItems.push({ name: 'Less: Drawings', amount: Math.abs(capDrw) });
        yr.liab.push({ title: 'CAPITAL ACCOUNT', items: capItems, total: closingCap, bold:true });
    } else {
        closingCap = pCalc.closingCap;
        let pItems = [];
        if (baseData.partners) {
            baseData.partners.forEach(p => { pItems.push({ name: p.name, amount: p.closingBal }); });
        }
        
        if(document.getElementById('schPartners')?.checked && baseData.partners.length > 0) {
            yr.liab.push({ title: `${bType==='company'?'SHARE CAPITAL':'PARTNERS CAPITAL'} (As per Sch. ${schNum})`, total: closingCap, bold:true });
            schedules.push({ isPartnerMatrix: true, num: schNum++, title: 'Partners Capital Account', partners: baseData.partners });
        } else {
            yr.liab.push({ title: bType==='company'?'SHARE CAPITAL':'PARTNERS CAPITAL', items: pItems, total: closingCap, bold:true });
        }
    }

    const sumArr = (arr) => arr.reduce((a, b) => a + (parseFloat(b.amount)||0), 0);
    let lALiabTotal = sumArr(baseData.loansAdvancesLiab);
    if(document.getElementById('schLoansLiab')?.checked && baseData.loansAdvancesLiab.length > 0) {
        yr.liab.push({ title: `LOANS & ADVANCES (As per Sch. ${schNum})`, total: lALiabTotal, bold:true });
        schedules.push({ num: schNum++, title: 'Loans & Advances (Liability)', items: baseData.loansAdvancesLiab, total: lALiabTotal });
    } else { if(lALiabTotal > 0) yr.liab.push({ title: 'LOANS & ADVANCES', items: baseData.loansAdvancesLiab, total: lALiabTotal, bold:true }); }

    let totalCL = baseLiab + sumArr(baseData.otherCurrentLiabilities);
    let clItems = [...baseData.currentLiabilities];
    clItems = clItems.concat(baseData.otherCurrentLiabilities);

    if(document.getElementById('schCurrentLiab')?.checked && clItems.length > 0) {
        yr.liab.push({ title: `CURRENT LIABILITIES (As per Sch. ${schNum})`, total: totalCL, bold:true });
        schedules.push({ num: schNum++, title: 'Current Liabilities & Provisions', items: clItems, total: totalCL });
    } else { if(totalCL > 0) yr.liab.push({ title: 'CURRENT LIABILITIES', items: clItems, total: totalCL, bold:true }); }

    let pAssetsTotal = sumArr(eMath.pAssets);
    if(document.getElementById('schFA')?.checked && eMath.pAssets.length > 0) {
        yr.asset.push({ title: `FIXED ASSETS (As per Sch. ${schNum})`, total: pAssetsTotal, bold:true });
        schedules.push({ isFAMatrix: true, num: schNum++, title: 'Fixed Assets (Net Block)', items: eMath.pAssets, total: pAssetsTotal });
    } else {
        if(eMath.pAssets.length > 0) {
            let faItems = eMath.pAssets.map(a => {
                let details = [];
                if (!a.depreciable && a.addition === 0 && !baseConfig.schZeroAdd) {
                    // Outer render only
                } else {
                    details.push({ label: 'Opening Balance', val: a.opening });
                    if(a.addition > 0 || baseConfig.schZeroAdd) { details.push({ label: 'Add: Addition', val: a.addition }); }
                    if(baseConfig.schFaSub && (a.addition > 0 || baseConfig.schZeroAdd)) { details.push({ label: 'Sub Total', val: a.opening + a.addition }); } 
                    if(a.depreciable) { details.push({ label: 'Less: Depreciation', val: a.depr }); }
                }
                return { name: a.name, amount: a.amount, details: details };
            });
            yr.asset.push({ title: 'FIXED ASSETS', items: faItems, total: pAssetsTotal, forceItems: true, bold:true });
        }
    }

    let currAssetItems = [];
    if (eMath.hasTrading && eMath.vClStock > 0) currAssetItems.push({ name: 'Closing Stock', amount: eMath.vClStock });
    
    if (document.getElementById('schDebtors')?.checked && baseData.receivables.length > 0) {
        currAssetItems.push({ name: `Sundry Debtors (Sch. ${schNum})`, amount: baseRec });
        schedules.push({ num: schNum++, title: 'Sundry Debtors', items: baseData.receivables, total: baseRec });
    } else { baseData.receivables.forEach(r => currAssetItems.push({ name: r.name, amount: r.amount })); }

    if (cashBalanceVal > 0) currAssetItems.push({ name: 'Cash in Hand', amount: cashBalanceVal });
    
    if (document.getElementById('schBank')?.checked && baseData.bankBalance.length > 0) {
        currAssetItems.push({ name: `Bank Balances (Sch. ${schNum})`, amount: baseBank });
        schedules.push({ num: schNum++, title: 'Bank Balances', items: baseData.bankBalance, total: baseBank });
    } else { baseData.bankBalance.forEach(b => currAssetItems.push({ name: b.name, amount: b.amount })); }

    baseData.currentAssets.forEach(c => currAssetItems.push({ name: c.name, amount: c.amount }));
    
    let totalCurrAssets = sumArr(currAssetItems);
    if(document.getElementById('schCurrentAssets')?.checked && currAssetItems.length > 0) {
        yr.asset.push({ title: `CURRENT ASSETS (As per Sch. ${schNum})`, total: totalCurrAssets, bold:true });
        schedules.push({ num: schNum++, title: 'Current Assets', items: currAssetItems, total: totalCurrAssets });
    } else { if(totalCurrAssets > 0) yr.asset.push({ title: 'CURRENT ASSETS', items: currAssetItems, total: totalCurrAssets, bold:true }); }

    let lAAssetTotal = sumArr(baseData.loansAdvancesAsset);
    if(document.getElementById('schLoansAsset')?.checked && baseData.loansAdvancesAsset.length > 0) {
        yr.asset.push({ title: `LOANS & ADVANCES (As per Sch. ${schNum})`, total: lAAssetTotal, bold:true });
        schedules.push({ num: schNum++, title: 'Loans & Advances (Asset)', items: baseData.loansAdvancesAsset, total: lAAssetTotal });
    } else { if(lAAssetTotal > 0) yr.asset.push({ title: 'LOANS & ADVANCES', items: baseData.loansAdvancesAsset, total: lAAssetTotal, bold:true }); }

    let bsPad = parseInt(baseConfig.padBS) || 0;
    for(let i=0; i<bsPad; i++) {
        yr.liab.push({ isBlank: true });
        yr.asset.push({ isBlank: true });
    }

    let tLiab = closingCap + sumArr(baseData.loansAdvancesLiab) + totalCL;
    let tAsset = pAssetsTotal + totalCurrAssets + sumArr(baseData.loansAdvancesAsset);
    
    let suspense = Math.round((tLiab - tAsset) * 100) / 100;
    if(suspense > 0) yr.asset.push({ title: 'Suspense A/c', total: suspense, bold: true });
    else if(suspense < 0) yr.liab.push({ title: 'Suspense A/c', total: Math.abs(suspense), bold: true });

    let reportSections = [];
    if (eMath.hasTrading) reportSections.push({ drArr: yr.drTrd, crArr: yr.crTrd, total: Math.max(eMath.vOpStock + eMath.vPur + eMath.vDirE + eMath.gp, eMath.vSal + eMath.vDirI + eMath.vClStock + eMath.gl) });
    
    let pnlDrTot = (eMath.hasTrading ? eMath.gl : eMath.vDirE) + eMath.vIndE + eMath.tDepr + (eMath.autoTargetNP >= 0 ? eMath.autoTargetNP : 0);
    let pnlCrTot = (eMath.hasTrading ? eMath.gp : eMath.vSal + eMath.vDirI) + eMath.vIndI + (eMath.autoTargetNP < 0 ? Math.abs(eMath.autoTargetNP) : 0);
    reportSections.push({ drArr: yr.drPnl, crArr: yr.crPnl, total: Math.max(pnlDrTot, pnlCrTot) });
    
    if(showApprop) reportSections.push({ drArr: yr.drApp, crArr: yr.crApp, total: Math.max(Math.abs(eMath.autoTargetNP), Math.abs(pCalc.divProfit)+pCalc.remunTotal+pCalc.intTotal) });

    let html = `<div class="statement-page"><div><h4 class="report-header">${currentCompany.name}</h4>`;
    html += `<div class="report-title">${mainTitle}</div>`;
    html += buildFourColumnContinuousTable(reportSections);
    html += `</div>${generateSignatureBlock(false)}</div>`;

    html += `<div class="statement-page">
        <div><h4 class="report-header">${currentCompany.name}</h4><div class="report-title">${bsTitle}</div>
        ${buildInnerOuterTable(yr.liab, yr.asset, Math.max(tLiab, tAsset) + Math.abs(suspense), "Liabilities", "Assets", "table-bs")}</div>
        ${generateSignatureBlock(false)}
    </div>`;

    html += buildSchedules(schedules);
    document.getElementById('reportContainer').innerHTML = html;
    if(document.getElementById('gridToggle')) window.toggleGrid(document.getElementById('gridToggle').checked);
}

// ----------------------------------------------------
// DEDICATED PROJECTION ENGINE
// ----------------------------------------------------
window.projBaseData = null;

window.openProjectionsTool = function() {
    if (!currentCompany.availableYears || currentCompany.availableYears.length === 0) {
        return customAlert("Projections require at least one saved actual financial year to establish a baseline.");
    }
    let sel = document.getElementById('projBaseYear');
    sel.innerHTML = '';
    currentCompany.availableYears.sort().reverse().forEach(y => sel.innerHTML += `<option value="${y}">${y}</option>`);
    window.switchView('view-projections');
    window.loadProjBase();
}

window.loadProjBase = async function() {
    showLoader("Loading Base Data...");
    let baseYear = document.getElementById('projBaseYear').value;
    try {
        const data = await secureFetch(`action=getCompanyData&companyId=${currentCompany.id}&year=${baseYear}`);
        window.projBaseData = data;
        window.buildProjInputs(); 
    } catch(e) {
        console.error(e);
        customAlert("Error loading base year.");
    }
    hideLoader();
}

window.buildProjInputs = function() {
    let n = parseInt(document.getElementById('projYears').value) || 1;
    
    let incomingFinData = window.projBaseData.finData || window.projBaseData; 
    let baseSettings = incomingFinData.settings || window.projBaseData.settings || {};
    let baseData = JSON.parse(JSON.stringify(incomingFinData));

    let sumBank = baseData.bankBalance ? baseData.bankBalance.reduce((a,b)=>a+(parseFloat(b.amount)||0),0) : 0;
    let sumRec = baseData.receivables ? baseData.receivables.reduce((a,b)=>a+(parseFloat(b.amount)||0),0) : 0;
    let sumLiab = baseData.currentLiabilities ? baseData.currentLiabilities.reduce((a,b)=>a+(parseFloat(b.amount)||0),0) : 0;
    let cashBalanceValProj = parseFloat(baseSettings.cashBalance) || 0;
    
    let html = '<hr class="my-4"><h6 class="fw-bold text-primary mb-3">Manual Projected Balances (End of Year Overrides)</h6><div class="table-responsive"><table class="table table-bordered table-sm text-center align-middle"><thead><tr class="bg-light"><th>Year</th><th>Cash in Hand</th><th>Bank Balance</th><th>Sundry Debtors</th><th>Current Liabilities</th></tr></thead><tbody>';
    
    for(let i=1; i<=n; i++) {
        let projYearLabel = incrementFY(baseSettings.yearEnd || baseSettings.year, i);
        html += `<tr>
            <td class="fw-bold bg-light">${projYearLabel}</td>
            <td><input type="number" id="proj-cash-${i}" class="form-control form-control-sm fw-bold" value="${cashBalanceValProj}" onchange="window.generateProjections()"></td>
            <td><input type="number" id="proj-bank-${i}" class="form-control form-control-sm fw-bold" value="${sumBank}" onchange="window.generateProjections()"></td>
            <td><input type="number" id="proj-rec-${i}" class="form-control form-control-sm fw-bold" value="${sumRec}" onchange="window.generateProjections()"></td>
            <td><input type="number" id="proj-liab-${i}" class="form-control form-control-sm fw-bold" value="${sumLiab}" onchange="window.generateProjections()"></td>
        </tr>`;
    }
    html += '</tbody></table></div>';
    document.getElementById('projInputsContainer').innerHTML = html;
    window.generateProjections();
}

window.generateProjections = function() {
    if (!window.projBaseData) return;
    
    const container = document.getElementById('projReportContainer');
    container.innerHTML = '';
    
    let incomingFinData = window.projBaseData.finData || window.projBaseData; 
    let baseSettings = incomingFinData.settings || window.projBaseData.settings || {};
    let baseConfig = incomingFinData.config || window.projBaseData.config || {};
    let baseData = JSON.parse(JSON.stringify(incomingFinData));
    
    const bType = baseSettings.businessType || 'proprietorship';
    const tMode = baseSettings.tradingMode || 'single';
    const forceTrd = (tMode === 'multi');
    const numYrs = parseInt(document.getElementById('projYears').value) || 1;
    const gRate = parseFloat(document.getElementById('projGrowth')?.value) / 100 || 0;
    const iRate = parseFloat(document.getElementById('projInflation')?.value) / 100 || 0;
    
    let capOp = parseFloat(baseSettings.capOpening) || 0;
    let capAdd = parseFloat(baseSettings.capAdditional) || 0;
    let capDrw = parseFloat(baseSettings.capDrawings) || 0;
    
    let prevClosingStock = baseData.closingStock ? JSON.parse(JSON.stringify(baseData.closingStock)) : [];

    for (let y = 1; y <= numYrs; y++) {
        let projYearEnd = incrementYearStr(baseSettings.yearEnd, y);
        let titleSuffix = projYearEnd ? ` FOR THE YEAR ENDED ${projYearEnd}` : '';
        let bsTitle = `PROJECTED BALANCE SHEET AS ON ${projYearEnd || ''}`;

        let mult = Math.pow((1 + gRate) * (1 + iRate), y);
        
        let pOpStock = JSON.parse(JSON.stringify(prevClosingStock));
        let eMath = computeEngineMath(baseData, baseSettings, mult, pOpStock);
        const isService = !eMath.hasTrading;
        
        let mainTitle = `PROJECTED ${isService ? "INCOME & EXPENDITURE A/C" : "TRADING AND PROFIT & LOSS A/C"}${titleSuffix}`;
        let yr = { drTrd: [], crTrd: [], drPnl: [], crPnl: [], drApp: [], crApp: [], liab: [], asset: [] }; 

        if (eMath.hasTrading) {
            if(eMath.pOpStock.length > 0) yr.drTrd.push({ title: 'Opening Stock', items: eMath.pOpStock, total: eMath.vOpStock, forceItems: forceTrd, cleanTitle: true });
            if(eMath.pPur.length > 0) yr.drTrd.push({ title: 'Purchases', items: eMath.pPur, total: eMath.vPur, forceItems: forceTrd, cleanTitle: true });
            eMath.pDirE.forEach(i => yr.drTrd.push({ title: i.name, total: i.amount, forceItems: false }));
            
            if(eMath.pSal.length > 0) yr.crTrd.push({ title: 'Sales', items: eMath.pSal, total: eMath.vSal, forceItems: forceTrd, cleanTitle: true });
            eMath.pDirI.forEach(i => yr.crTrd.push({ title: i.name, total: i.amount, forceItems: false }));
            if(eMath.pClStock.length > 0) yr.crTrd.push({ title: 'Closing Stock', items: eMath.pClStock, total: eMath.vClStock, forceItems: forceTrd, cleanTitle: true });

            if(eMath.gp > 0) yr.drTrd.push({ title: 'Gross Profit c/d', total: eMath.gp, bold: true });
            if(eMath.gl > 0) yr.crTrd.push({ title: 'Gross Loss c/d', total: eMath.gl, bold: true });
        }

        if (eMath.hasTrading) {
            if (eMath.gl > 0) yr.drPnl.push({ title: 'Gross Loss b/d', total: eMath.gl, bold: true });
            if (eMath.gp > 0) yr.crPnl.push({ title: 'Gross Profit b/d', total: eMath.gp, bold: true });
        } else {
            eMath.pDirE.forEach(i => yr.drPnl.push({ title: i.name, total: i.amount, forceItems: false }));
            if (eMath.pSal.length > 0) yr.crPnl.push({ title: 'Gross Receipts', items: eMath.pSal, total: eMath.vSal, forceItems: forceTrd, cleanTitle: true });
            eMath.pDirI.forEach(i => yr.crPnl.push({ title: i.name, total: i.amount, forceItems: false }));
        }

        eMath.pIndE.forEach(i => yr.drPnl.push({ title: i.name, total: i.amount, forceItems: false }));
        if (eMath.tDepr > 0) yr.drPnl.push({ title: 'Depreciation', total: eMath.tDepr, forceItems: false });
        eMath.pIndI.forEach(i => yr.crPnl.push({ title: i.name, total: i.amount, forceItems: false }));

        let npTitle = (bType === 'proprietorship') ? 'Net Profit transferred to Capital Account' : 'Net Profit c/f';
        let nlTitle = (bType === 'proprietorship') ? 'Net Loss transferred to Capital Account' : 'Net Loss c/f';
        if (eMath.autoTargetNP >= 0) { yr.drPnl.push({ title: npTitle, total: eMath.autoTargetNP, bold: true }); } 
        else { yr.crPnl.push({ title: nlTitle, total: Math.abs(eMath.autoTargetNP), bold: true }); }

        let pnlPad = parseInt(baseConfig.padPnl) || 5;
        let pnlDrRows = yr.drPnl.reduce((acc, b) => acc + flattenFourColBlock(b, 'To').length, 0);
        while(pnlDrRows < pnlPad - 1) { yr.drPnl.push({ isBlank: true }); pnlDrRows++; }

        let pnlCrRows = yr.crPnl.reduce((acc, b) => acc + flattenFourColBlock(b, 'By').length, 0);
        while(pnlCrRows < pnlPad - 1) { yr.crPnl.push({ isBlank: true }); pnlCrRows++; }

        let showApprop = false;
        let pCalc = { remunTotal: 0, intTotal: 0, divProfit: eMath.autoTargetNP, closingCap: 0 };

        if(bType !== 'proprietorship') {
            pCalc = allocatePartnerCapital(baseData.partners, eMath.autoTargetNP);
            showApprop = true;

            if(pCalc.remunTotal > 0) yr.drApp.push({ title: 'Partner Remuneration', total: pCalc.remunTotal });
            if(pCalc.intTotal > 0) yr.drApp.push({ title: 'Interest on Capital', total: pCalc.intTotal });
            
            let divTitle = pCalc.divProfit >= 0 ? "Profit transferred to Partners' Capital A/c" : "Loss transferred to Partners' Capital A/c";
            let partnerItems = baseData.partners.map(p => ({name: p.name, amount: Math.abs(p.profitShare)}));

            if (pCalc.divProfit >= 0) { 
                yr.drApp.push({ title: divTitle, items: partnerItems, total: pCalc.divProfit, forceItems: true, cleanTitle: true, noUpper: true }); 
            } else { 
                yr.crApp.push({ title: divTitle, items: partnerItems, total: Math.abs(pCalc.divProfit), forceItems: true, cleanTitle: true, noUpper: true }); 
            }
            
            if (eMath.autoTargetNP >= 0) { yr.crApp.push({ title: 'Net Profit b/d', total: eMath.autoTargetNP, bold: true }); } 
            else { yr.drApp.push({ title: 'Net Loss b/d', total: Math.abs(eMath.autoTargetNP), bold: true }); }
        }

        let closingCap = 0;
        let schedules = []; let schNum = 1;

        if(bType === 'proprietorship') {
            closingCap = capOp + capAdd + eMath.autoTargetNP - capDrw;
            let capItems = [{ name: 'Opening Balance', amount: capOp }];
            if (capAdd > 0) capItems.push({ name: 'Add: Additional Capital', amount: capAdd });
            if (eMath.autoTargetNP >= 0) capItems.push({ name: 'Add: Net Profit', amount: eMath.autoTargetNP });
            else capItems.push({ name: 'Less: Net Loss', amount: Math.abs(eMath.autoTargetNP) });
            if (capDrw > 0) capItems.push({ name: 'Less: Drawings', amount: Math.abs(capDrw) });
            yr.liab.push({ title: 'CAPITAL ACCOUNT', items: capItems, total: closingCap, bold:true });
        } else {
            closingCap = pCalc.closingCap;
            let pItems = [];
            if (baseData.partners) {
                baseData.partners.forEach(p => { pItems.push({ name: p.name, amount: p.closingBal }); });
            }
            if(baseConfig.schPartners && baseData.partners && baseData.partners.length > 0) {
                yr.liab.push({ title: `${bType==='company'?'SHARE CAPITAL':'PARTNERS CAPITAL'} (As per Sch. ${schNum})`, total: closingCap, bold:true });
                schedules.push({ isPartnerMatrix: true, num: schNum++, title: 'Partners Capital Account', partners: baseData.partners });
            } else {
                yr.liab.push({ title: bType==='company'?'SHARE CAPITAL':'PARTNERS CAPITAL', items: pItems, total: closingCap, bold:true });
            }
        }

        const sumArr = (arr) => arr ? arr.reduce((a, b) => a + (parseFloat(b.amount)||0), 0) : 0;
        let lALiabTotal = sumArr(baseData.loansAdvancesLiab);
        if(baseConfig.schLoansLiab && baseData.loansAdvancesLiab && baseData.loansAdvancesLiab.length > 0) {
            yr.liab.push({ title: `LOANS & ADVANCES (As per Sch. ${schNum})`, total: lALiabTotal, bold:true });
            schedules.push({ num: schNum++, title: 'Loans & Advances (Liability)', items: baseData.loansAdvancesLiab, total: lALiabTotal });
        } else { if(lALiabTotal > 0) yr.liab.push({ title: 'LOANS & ADVANCES', items: baseData.loansAdvancesLiab, total: lALiabTotal, bold:true }); }

        let pLiab = parseFloat(document.getElementById('proj-liab-'+y)?.value) || 0;
        let otherLiab = sumArr(baseData.otherCurrentLiabilities);
        let totalCL = pLiab + otherLiab;
        let clItems = [{name: 'Current Liabilities', amount: pLiab}];
        if(baseData.otherCurrentLiabilities) clItems = clItems.concat(baseData.otherCurrentLiabilities);

        if(baseConfig.schCurrentLiab && clItems.length > 0) {
            yr.liab.push({ title: `CURRENT LIABILITIES (As per Sch. ${schNum})`, total: totalCL, bold:true });
            schedules.push({ num: schNum++, title: 'Current Liabilities & Provisions', items: clItems, total: totalCL });
        } else { if(totalCL > 0) yr.liab.push({ title: 'CURRENT LIABILITIES', items: clItems, total: totalCL, bold:true }); }

        let pAssetsTotal = sumArr(eMath.pAssets);
        if(baseConfig.schFA && eMath.pAssets.length > 0) {
            yr.asset.push({ title: `FIXED ASSETS (As per Sch. ${schNum})`, total: pAssetsTotal, bold:true });
            schedules.push({ isFAMatrix: true, num: schNum++, title: 'Fixed Assets (Net Block)', items: eMath.pAssets, total: pAssetsTotal });
        } else {
            if(eMath.pAssets.length > 0) {
                let faItems = eMath.pAssets.map(a => {
                    let details = [];
                    if (!a.depreciable && a.addition === 0 && !baseConfig.schZeroAdd) {
                        // Outer render only
                    } else {
                        details.push({ label: 'Opening Balance', val: a.opening });
                        if(a.addition > 0 || baseConfig.schZeroAdd) { details.push({ label: 'Add: Addition', val: a.addition }); }
                        if(baseConfig.schFaSub && (a.addition > 0 || baseConfig.schZeroAdd)) { details.push({ label: 'Sub Total', val: a.opening + a.addition }); } 
                        if(a.depreciable) { details.push({ label: 'Less: Depreciation', val: a.depr }); }
                    }
                    return { name: a.name, amount: a.amount, details: details };
                });
                yr.asset.push({ title: 'FIXED ASSETS', items: faItems, total: pAssetsTotal, forceItems: true, bold:true });
            }
        }
        
        let pCashBal = parseFloat(document.getElementById('proj-cash-'+y)?.value) || 0;
        let pBankBal = parseFloat(document.getElementById('proj-bank-'+y)?.value) || 0;
        let pRec = parseFloat(document.getElementById('proj-rec-'+y)?.value) || 0;

        let currAssetItems = [];
        if (eMath.hasTrading && eMath.vClStock > 0) currAssetItems.push({ name: 'Closing Stock', amount: eMath.vClStock });
        
        if (baseConfig.schDebtors && baseData.receivables && baseData.receivables.length > 0) {
            currAssetItems.push({ name: `Sundry Debtors (Sch. ${schNum})`, amount: pRec });
            schedules.push({ num: schNum++, title: 'Sundry Debtors', items: [{name: 'Debtors', amount: pRec}], total: pRec });
        } else { if(pRec > 0) currAssetItems.push({ name: 'Sundry Debtors', amount: pRec }); }

        if (pCashBal > 0) currAssetItems.push({ name: 'Cash in Hand', amount: pCashBal });
        
        if (baseConfig.schBank && baseData.bankBalance && baseData.bankBalance.length > 0) {
            currAssetItems.push({ name: `Bank Balances (Sch. ${schNum})`, amount: pBankBal });
            schedules.push({ num: schNum++, title: 'Bank Balances', items: [{name: 'Bank', amount: pBankBal}], total: pBankBal });
        } else { if(pBankBal > 0) currAssetItems.push({ name: 'Bank Balances', amount: pBankBal }); }

        if(baseData.currentAssets) baseData.currentAssets.forEach(c => currAssetItems.push({ name: c.name, amount: c.amount }));
        
        let totalCurrAssets = sumArr(currAssetItems);
        if(baseConfig.schCurrentAssets && currAssetItems.length > 0) {
            yr.asset.push({ title: `CURRENT ASSETS (As per Sch. ${schNum})`, total: totalCurrAssets, bold:true });
            schedules.push({ num: schNum++, title: 'Current Assets', items: currAssetItems, total: totalCurrAssets });
        } else { if(totalCurrAssets > 0) yr.asset.push({ title: 'CURRENT ASSETS', items: currAssetItems, total: totalCurrAssets, bold:true }); }

        let lAAssetTotal = sumArr(baseData.loansAdvancesAsset);
        if(baseConfig.schLoansAsset && baseData.loansAdvancesAsset && baseData.loansAdvancesAsset.length > 0) {
            yr.asset.push({ title: `LOANS & ADVANCES (As per Sch. ${schNum})`, total: lAAssetTotal, bold:true });
            schedules.push({ num: schNum++, title: 'Loans & Advances (Asset)', items: baseData.loansAdvancesAsset, total: lAAssetTotal });
        } else { if(lAAssetTotal > 0) yr.asset.push({ title: 'LOANS & ADVANCES', items: baseData.loansAdvancesAsset, total: lAAssetTotal, bold:true }); }

        let bsPad = parseInt(baseConfig.padBS) || 0;
        for(let i=0; i<bsPad; i++) {
            yr.liab.push({ isBlank: true });
            yr.asset.push({ isBlank: true });
        }

        let tLiab = closingCap + sumArr(baseData.loansAdvancesLiab) + totalCL;
        let tAsset = pAssetsTotal + totalCurrAssets + sumArr(baseData.loansAdvancesAsset);
        
        let suspense = Math.round((tLiab - tAsset) * 100) / 100;
        if(suspense > 0) yr.asset.push({ title: 'Suspense A/c', total: suspense, bold: true });
        else if(suspense < 0) yr.liab.push({ title: 'Suspense A/c', total: Math.abs(suspense), bold: true });

        let reportSections = [];
        if (eMath.hasTrading) reportSections.push({ drArr: yr.drTrd, crArr: yr.crTrd, total: Math.max(eMath.vOpStock + eMath.vPur + eMath.vDirE + eMath.gp, eMath.vSal + eMath.vDirI + eMath.vClStock + eMath.gl) });
        
        let pnlDrTot = (eMath.hasTrading ? eMath.gl : eMath.vDirE) + eMath.vIndE + eMath.tDepr + (eMath.autoTargetNP >= 0 ? eMath.autoTargetNP : 0);
        let pnlCrTot = (eMath.hasTrading ? eMath.gp : eMath.vSal + eMath.vDirI) + eMath.vIndI + (eMath.autoTargetNP < 0 ? Math.abs(eMath.autoTargetNP) : 0);
        reportSections.push({ drArr: yr.drPnl, crArr: yr.crPnl, total: Math.max(pnlDrTot, pnlCrTot) });
        
        if(showApprop) reportSections.push({ drArr: yr.drApp, crArr: yr.crApp, total: Math.max(Math.abs(eMath.autoTargetNP), Math.abs(pCalc.divProfit)+pCalc.remunTotal+pCalc.intTotal) });

        let html = `<div class="statement-page"><div><h4 class="report-header">${currentCompany.name}</h4>`;
        html += `<div class="report-title">${mainTitle}</div>`;
        html += buildFourColumnContinuousTable(reportSections);
        html += `</div>${generateSignatureBlock(true)}</div>`;

        html += `
        <div class="statement-page">
            <div><h4 class="report-header">${currentCompany.name}</h4><div class="report-title">${bsTitle}</div>
            ${buildInnerOuterTable(yr.liab, yr.asset, Math.max(tLiab, tAsset) + Math.abs(suspense), "Liabilities", "Assets", "table-bs")}</div>
            ${generateSignatureBlock(true)}
        </div>`;

        html += buildSchedules(schedules);
        
        container.innerHTML += html;

        // Carry Forward for next proj year
        capOp = closingCap; capAdd = 0; capDrw = 0; 
        if(baseData.fixedAssets) {
            baseData.fixedAssets = eMath.pAssets.map(a => ({ name: a.name, opening: a.amount, addition: 0, amount: a.amount, rate: a.rate, depreciable: a.depreciable }));
        }
        prevClosingStock = JSON.parse(JSON.stringify(eMath.pClStock));
        if(bType !== 'proprietorship' && baseData.partners) {
            baseData.partners.forEach(p => {
                p.opening = p.closingBal;
                p.remun = 0; p.intCap = 0; p.draw = 0;
            });
        }
    }
}

window.exportExcel = function() {
    let wb = XLSX.utils.book_new();
    let activeContainer = document.getElementById('view-preview').classList.contains('d-none') ? '#projReportContainer' : '#reportContainer';
    let tables = document.querySelectorAll(`${activeContainer} .fin-table`);
    
    if(tables.length === 0) return customAlert("Generate reports first to export.");
    
    tables.forEach((table, i) => {
        let sheetName = i === 0 ? "Income_Statement" : (i === 1 ? "Balance_Sheet" : `Schedule_${i-1}`);
        let wsData = [];
        wsData.push([currentCompany.name.toUpperCase()]);
        
        let titleBlock = table.previousElementSibling;
        if(titleBlock && titleBlock.classList.contains('report-title')) wsData.push([titleBlock.innerText]);
        wsData.push([]); 
        
        let trs = table.querySelectorAll('tr');
        trs.forEach(tr => {
            let row = [];
            tr.querySelectorAll('th, td').forEach(td => { row.push(td.innerText.replace(/\u20B9/g, '').trim()); });
            wsData.push(row);
        });
        
        let ws = XLSX.utils.aoa_to_sheet(wsData);
        if(i === 0) ws['!cols'] = [{wch: 35}, {wch: 15}, {wch: 35}, {wch: 15}];
        else if (i === 1) ws['!cols'] = [{wch: 30}, {wch: 12}, {wch: 12}, {wch: 30}, {wch: 12}, {wch: 12}];
        else ws['!cols'] = [{wch: 35}, {wch: 15}, {wch: 15}, {wch: 15}];
        
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
    
    XLSX.writeFile(wb, `${currentCompany.name}_Financials.xlsx`);
}

window.printReport = function() { window.print(); }

window.exportPDF = function() {
    document.body.classList.add('pdf-mode');
    const opt = { 
        margin: [5, 5, 5, 5], 
        filename: `${currentCompany.name}_Financials.pdf`, 
        image: { type: 'jpeg', quality: 0.98 }, 
        html2canvas: { scale: 2, useCORS: true, letterRendering: true, windowWidth: 1000 }, 
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
    };
    html2pdf().set(opt).from(document.getElementById('reportContainer')).save().then(() => {
        document.body.classList.remove('pdf-mode');
    });
}

window.exportProjPDF = function() {
    document.body.classList.add('pdf-mode');
    const opt = { 
        margin: [5, 5, 5, 5], 
        filename: `${currentCompany.name}_Projections.pdf`, 
        image: { type: 'jpeg', quality: 0.98 }, 
        html2canvas: { scale: 2, useCORS: true, letterRendering: true, windowWidth: 1000 }, 
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
    };
    html2pdf().set(opt).from(document.getElementById('projReportContainer')).save().then(() => {
        document.body.classList.remove('pdf-mode');
    });
}

window.showTrialBalance = function() {
    const bType = document.getElementById('businessType').value;
    
    finData.settings.trdBal = document.getElementById('trdBal').value;
    finData.settings.trdTarget = Number(document.getElementById('trdTarget').value);
    finData.settings.trdAutoName = document.getElementById('trdAutoName').value;
    finData.settings.pnlBal = document.getElementById('pnlBal').value;
    finData.settings.pnlTarget = Number(document.getElementById('pnlTarget').value);
    finData.settings.pnlAutoName = document.getElementById('pnlAutoName').value;

    let eMath = computeEngineMath(finData, finData.settings);
    const isService = !eMath.hasTrading;

    const capOp = parseFloat(document.getElementById('capOpening').value) || 0;
    const capAdd = parseFloat(document.getElementById('capAdditional').value) || 0;
    const capDrw = parseFloat(document.getElementById('capDrawings').value) || 0;

    let rows = [];
    const pushRow = (name, dr, cr) => { if(dr !== 0 || cr !== 0) rows.push({name, dr, cr}); };

    let grossAssets = 0;
    finData.fixedAssets.forEach(a => { grossAssets += (parseFloat(a.opening) || 0) + (parseFloat(a.addition) || 0); });

    pushRow('Fixed Assets (Gross)', grossAssets, 0);
    if (eMath.hasTrading) { 
        pushRow('Opening Stock', eMath.vOpStock, 0); 
        pushRow('Purchases', eMath.vPur, 0); 
    }
    pushRow('Direct Expenses', eMath.vDirE, 0);
    pushRow('Indirect Expenses', eMath.vIndE + eMath.tDepr, 0); 
    
    let autoExpAmt = Math.round((eMath.gp + eMath.vIndI + (isService ? eMath.vSal + eMath.vDirI : 0) - (eMath.vIndE + eMath.tDepr + (isService ? eMath.vDirE : eMath.gl)) - finData.settings.pnlTarget) * 100) / 100;
    
    if (autoExpAmt > 0) pushRow(`${finData.settings.pnlAutoName}`, autoExpAmt, 0);
    else if (autoExpAmt < 0) pushRow(`${finData.settings.pnlAutoName}`, 0, Math.abs(autoExpAmt));
    
    const sumArr = (arr) => arr.reduce((a, b) => a + (parseFloat(b.amount)||0), 0);
    pushRow('Sundry Debtors', sumArr(finData.receivables), 0);
    pushRow('Cash in Hand', cashBalanceVal, 0);
    pushRow('Bank Balances', sumArr(finData.bankBalance), 0);
    pushRow('Other Current Assets', sumArr(finData.currentAssets), 0);
    pushRow('Loans & Advances (Asset)', sumArr(finData.loansAdvancesAsset), 0);

    if (bType === 'proprietorship') {
        pushRow('Drawings', capDrw, 0);
        pushRow('Opening Capital', 0, capOp);
        pushRow('Additional Capital', 0, capAdd);
    } else {
        let pOp = sumArr(finData.partners.map(p=>({amount: p.opening})));
        let pAdd = sumArr(finData.partners.map(p=>({amount: p.addCap})));
        let pDraw = sumArr(finData.partners.map(p=>({amount: p.draw})));
        let pRemun = sumArr(finData.partners.map(p=>({amount: p.remun})));
        let pInt = sumArr(finData.partners.map(p=>({amount: p.intCap})));
        
        pushRow('Partners Drawings', pDraw, 0);
        pushRow('Partners Opening Capital', 0, pOp);
        pushRow('Partners Additional Capital', 0, pAdd);
        pushRow('Profit Appropriations', 0, pRemun + pInt);
    }

    if (eMath.hasTrading) pushRow('Sales', 0, eMath.vSal); else pushRow('Gross Receipts', 0, eMath.vSal);
    pushRow('Direct Incomes', 0, eMath.vDirI);
    pushRow('Indirect Incomes', 0, eMath.vIndI);
    pushRow('Current Liabilities', 0, sumArr(finData.currentLiabilities));
    pushRow('Other Current Liabilities', 0, sumArr(finData.otherCurrentLiabilities));
    pushRow('Loans & Advances (Liability)', 0, sumArr(finData.loansAdvancesLiab));

    let totalDr = rows.reduce((a,b)=>a+b.dr, 0);
    let totalCr = rows.reduce((a,b)=>a+b.cr, 0);
    let diff = Math.round((totalDr - totalCr) * 100) / 100;

    if (diff > 0) pushRow('Suspense A/c', 0, diff);
    else if (diff < 0) pushRow('Suspense A/c', Math.abs(diff), 0);

    let finalT = Math.max(totalDr, totalCr);
    let html = '';
    rows.forEach(r => { html += `<tr><td>${r.name}</td><td class="text-end amount">${r.dr!==0?fmt(r.dr):'-'}</td><td class="text-end amount">${r.cr!==0?fmt(r.cr):'-'}</td></tr>`; });
    document.getElementById('tb-body').innerHTML = html;
    document.getElementById('tb-foot').innerHTML = `<tr><td>Total</td><td class="text-end amount">${fmt(finalT)}</td><td class="text-end amount">${fmt(finalT)}</td></tr>`;
    new bootstrap.Modal(document.getElementById('tbModal')).show();
}
