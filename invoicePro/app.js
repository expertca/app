// ====== IMPORTANT: PASTE YOUR GOOGLE WEB APP URL HERE ======
const API_URL = "https://script.google.com/macros/s/AKfycbw5nV8VCp3w_gmVck3MjYzG8vEegFLESFM8RB0PA5bb5rtocmDDn3O8fM0iolY-XCYQ/exec";

let loadedData = { company: {}, clients: [], services: [], invoices: [], receipts: [], invoiceItems: [] };
let invoiceItems = [];
let currentStmtClient = null;
let currentPreviewContext = {}; 
let revenueChartInstance = null; // Store chart instance to destroy it before re-rendering

function customAlert(message) { document.getElementById('alertMessage').innerText = message; new bootstrap.Modal(document.getElementById('alertModal')).show(); }

function showView(viewId) {
    document.querySelectorAll('.app-view').forEach(v => v.classList.add('d-none'));
    document.getElementById(viewId).classList.remove('d-none');
    window.scrollTo(0, 0);
}

// --- INDEXED DB ENGINE ---
let db;
function initDB(callback) { let req = window.indexedDB.open('InvoiceProDB', 1); req.onupgradeneeded = e => { db = e.target.result; if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'id' }); if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' }); }; req.onsuccess = e => { db = e.target.result; if(callback) callback(); }; req.onerror = () => { if(callback) callback(); }; }
function updateSyncStatus(status) { const badges = document.querySelectorAll('.sync-badge'); badges.forEach(badge => { if(status === 'Synced') { badge.className = 'badge bg-success sync-badge'; badge.innerText = 'Synced'; } else if(status === 'Offline') { badge.className = 'badge bg-warning text-dark sync-badge'; badge.innerText = 'Offline Mode'; } else if(status === 'Pending') { badge.className = 'badge bg-danger sync-badge'; badge.innerText = 'Pending Sync'; } else { badge.className = 'badge bg-primary sync-badge'; badge.innerText = 'Syncing...'; } }); }
function saveLocalCache(data) { try { localStorage.setItem('InvoiceProCache', JSON.stringify(data)); } catch(e){} if(db) { try { let tx = db.transaction('cache', 'readwrite'); tx.objectStore('cache').put({ key: 'loadedData', data: data }); } catch(e){} } }
function loadLocalCache(callback) { let hasCache = false; try { const cached = localStorage.getItem('InvoiceProCache'); if (cached) { loadedData = JSON.parse(cached); calculateBalances(); renderTables(); populateDropdowns(); hasCache = true; } } catch(e){} if(callback) callback(hasCache); }

async function apiCall(action, ...params) { const response = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: action, params: params }) }); const result = await response.json(); if(!result.success) throw new Error(result.error); return result.data; }

function loadApp() {
  initDB(() => {
    loadLocalCache((hasCache) => {
      if(hasCache) { document.getElementById('loaderOverlay').classList.add('d-none'); }
      if(!navigator.onLine) { updateSyncStatus('Offline'); document.getElementById('loaderOverlay').classList.add('d-none'); return; }
      updateSyncStatus('Syncing...');
      apiCall('getInitialData').then(data => { loadedData = data || { company: {}, clients: [], services: [], invoices: [], receipts: [], invoiceItems: [] }; saveLocalCache(loadedData); calculateBalances(); renderTables(); populateDropdowns(); updateSyncStatus('Synced'); document.getElementById('loaderOverlay').classList.add('d-none'); processQueue(); }).catch(err => { updateSyncStatus('Offline'); document.getElementById('loaderOverlay').classList.add('d-none'); });
    });
  });
}
window.addEventListener('online', () => { updateSyncStatus('Syncing...'); loadApp(); }); window.addEventListener('offline', () => updateSyncStatus('Offline'));
function saveToQueue(action, params) { if(!db) return; try { let tx = db.transaction('syncQueue', 'readwrite'); tx.objectStore('syncQueue').add({ id: Date.now().toString(), action: action, params: params }); updateSyncStatus('Pending'); } catch(e){} }
function processQueue() { if (!navigator.onLine || !db) return; try { let tx = db.transaction('syncQueue', 'readonly'); let req = tx.objectStore('syncQueue').getAll(); req.onsuccess = () => { let queue = req.result; if (queue.length === 0) return; updateSyncStatus('Syncing...'); let item = queue[0]; apiCall(item.action, ...item.params).then(() => { let dTx = db.transaction('syncQueue', 'readwrite'); dTx.objectStore('syncQueue').delete(item.id); dTx.oncomplete = () => processQueue(); }).catch(() => updateSyncStatus('Offline')); }; } catch(e){} }
function executeSave(action, ...params) { optimisticUpdate(action, params); if (!navigator.onLine) { saveToQueue(action, params); return; } updateSyncStatus('Syncing...'); apiCall(action, ...params).then(() => { loadApp(); }).catch(() => { saveToQueue(action, params); }); }
function confirmDelete(type, id) { if(confirm(`Delete this ${type}? Linked records will also be removed.`)) { showView('dashboardView'); executeSave('deleteRecord', type, id); } }

function optimisticUpdate(action, params) {
  let m = document.querySelector('.modal.show'); if(m) bootstrap.Modal.getInstance(m).hide();
  const tempId = 'TMP-' + Date.now().toString().substring(5);
  if(action === 'addClient') loadedData.clients.push({ ID: tempId, Name: params[0], 'Contact Name': params[1], Email: params[2], Mobile: params[3] });
  else if(action === 'addService') loadedData.services.push({ ID: tempId, Name: params[0], Description: params[1], Rate: params[2] });
  else if(action === 'addReceipt') loadedData.receipts.push({ 'Receipt ID': params[4] || tempId, 'Invoice ID': params[0], Date: params[1], Amount: params[2], 'Payment Mode': params[3], 'Client ID': params[5] });
  else if(action === 'addInvoice') { loadedData.invoices.push({ 'Invoice ID': tempId, 'Client ID': params[0].clientId, 'Client Name': params[0].clientName, Date: params[0].date, 'Due Date': params[0].dueDate, 'Invoice Number': params[0].invNum, 'Net Amount': params[0].netAmount }); }
  else if (action === 'deleteRecord') {
    let type = params[0]; let id = params[1];
    if(type === 'client') { loadedData.clients = loadedData.clients.filter(c => c.ID !== id); let invIds = loadedData.invoices.filter(i => i['Client ID'] === id).map(i => i['Invoice ID']); loadedData.invoices = loadedData.invoices.filter(i => i['Client ID'] !== id); loadedData.receipts = loadedData.receipts.filter(r => !invIds.includes(r['Invoice ID']) && r['Client ID'] !== id); }
    else if(type === 'invoice') { loadedData.invoices = loadedData.invoices.filter(i => i['Invoice ID'] !== id); loadedData.receipts = loadedData.receipts.filter(r => r['Invoice ID'] !== id); }
    else if(type === 'service') { loadedData.services = loadedData.services.filter(s => s.ID !== id); }
    else if(type === 'receipt') { loadedData.receipts = loadedData.receipts.filter(r => r['Receipt ID'] !== id); }
  }
  saveLocalCache(loadedData); calculateBalances(); renderTables(); populateDropdowns();
}

function calculateBalances() {
  if(!loadedData.invoices) loadedData.invoices = []; if(!loadedData.receipts) loadedData.receipts = []; if(!loadedData.clients) loadedData.clients = [];
  loadedData.invoices.forEach(inv => {
    let recs = loadedData.receipts.filter(r => r['Invoice ID'] === inv['Invoice ID']);
    let paid = recs.reduce((sum, r) => sum + (parseFloat(r.Amount) || 0), 0);
    inv.paidAmount = paid; inv.balance = (parseFloat(inv['Net Amount']) || 0) - paid;
  });
  loadedData.clients.forEach(c => {
    let cInvs = loadedData.invoices.filter(i => i['Client ID'] === c.ID);
    let invBal = cInvs.reduce((sum, inv) => sum + (inv.balance || 0), 0);
    let unlinkedRecs = loadedData.receipts.filter(r => r['Client ID'] === c.ID && (!r['Invoice ID'] || r['Invoice ID'] === ''));
    let advancePaid = unlinkedRecs.reduce((sum, r) => sum + (parseFloat(r.Amount) || 0), 0);
    c.balanceDue = invBal - advancePaid;
  });
}

function populateDropdowns() {
  let cList = document.getElementById('clientList'); if(cList) { cList.innerHTML = ''; loadedData.clients.forEach(c => cList.innerHTML += `<option value="${c.Name}">`); }
  let sList = document.getElementById('serviceList'); if(sList) { sList.innerHTML = ''; loadedData.services.forEach(s => sList.innerHTML += `<option value="${s.Name}">`); }
  let rList = document.getElementById('receiptClientList'); if(rList) { rList.innerHTML = ''; loadedData.clients.forEach(c => rList.innerHTML += `<option value="${c.Name}">`); }
}

// --- NEW DASHBOARD RENDERING LOGIC ---
function renderDashboard() {
    let totalDue = 0; let totalRevThisYear = 0; let overdueCount = 0;
    const now = new Date(); const currentYear = now.getFullYear();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    
    // Setup Chart Data Array [MonthNames, Totals]
    let monthlyData = {};
    for(let i=5; i>=0; i--) {
        let d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthlyData[d.toLocaleString('default', { month: 'short' })] = 0;
    }

    loadedData.invoices.forEach(inv => {
        if(inv.balance > 0) totalDue += inv.balance;
        
        let invDate = new Date(inv.Date);
        if(invDate.getFullYear() === currentYear) totalRevThisYear += (parseFloat(inv['Net Amount']) || 0);
        
        // Populate Chart
        if(invDate >= sixMonthsAgo) {
            let monthName = invDate.toLocaleString('default', { month: 'short' });
            if(monthlyData[monthName] !== undefined) monthlyData[monthName] += (parseFloat(inv['Net Amount']) || 0);
        }

        // Overdue Check
        let dueDateStr = inv['Due Date'] || inv.dueDate; 
        if(!dueDateStr) {
            // If no due date, default to 15 days after invoice date
            let d = new Date(invDate); d.setDate(d.getDate() + 15); dueDateStr = d;
        }
        if(inv.balance > 0 && new Date(dueDateStr) < new Date(now.setHours(0,0,0,0))) overdueCount++;
    });

    document.getElementById('dashTotalDue').innerText = '₹' + totalDue.toFixed(2);
    document.getElementById('dashTotalRev').innerText = '₹' + totalRevThisYear.toFixed(2);
    document.getElementById('dashOverdueCount').innerText = overdueCount;

    // Render Chart
    const ctx = document.getElementById('revenueChart');
    if(ctx) {
        if(revenueChartInstance) revenueChartInstance.destroy(); // Prevent canvas overlay issues
        revenueChartInstance = new Chart(ctx, {
            type: 'bar',
            data: { labels: Object.keys(monthlyData), datasets: [{ label: 'Revenue (₹)', data: Object.values(monthlyData), backgroundColor: '#4f46e5', borderRadius: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { display: false } }, x: { grid: { display: false } } } }
        });
    }

    // Recent Activity Feed
    let activity = [];
    loadedData.invoices.forEach(i => activity.push({ date: new Date(i.Date), text: `Created Invoice <b>${i['Invoice Number']}</b> for ${i['Client Name']} (₹${i['Net Amount']})`, icon: 'bi-file-earmark-text', color: 'text-primary' }));
    loadedData.receipts.forEach(r => { let cl = loadedData.clients.find(c => c.ID === r['Client ID']); let cName = cl ? cl.Name : 'Unknown'; activity.push({ date: new Date(r.Date), text: `Received <b>₹${r.Amount}</b> from ${cName}`, icon: 'bi-cash-stack', color: 'text-success' }); });
    
    activity.sort((a,b) => b.date - a.date); // Sort newest first
    let feedHtml = activity.slice(0, 10).map(a => `<div class="d-flex mb-3"><div class="me-3 ${a.color}"><i class="bi ${a.icon} fs-5"></i></div><div><div class="small">${a.text}</div><div class="text-muted" style="font-size:0.7rem;">${a.date.toLocaleDateString()}</div></div></div>`).join('');
    document.getElementById('dashRecentActivity').innerHTML = feedHtml || '<p class="text-muted small">No recent activity.</p>';
}

// --- WHATSAPP REMINDER LOGIC ---
function sendWhatsAppReminder(invId) {
    const inv = loadedData.invoices.find(i => i['Invoice ID'] === invId);
    const client = loadedData.clients.find(c => c.ID === inv['Client ID']);
    if(!client || !client.Mobile) return customAlert("No mobile number saved for this client.");
    
    const phone = client.Mobile.replace(/[^\d]/g, '');
    const text = `Hello ${inv['Client Name']},\n\nA gentle reminder that Invoice *${inv['Invoice Number']}* has a pending balance of *₹${inv.balance.toFixed(2)}*.\n\nPlease let us know when this can be cleared. Thank you!`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
}

// --- UNIVERSAL PREVIEW & PDF LOGIC ---
let currentZoom = 1;
function zoomPreview(delta) { currentZoom += delta; if(currentZoom < 0.3) currentZoom = 0.3; if(currentZoom > 2.5) currentZoom = 2.5; const scaleWrapper = document.getElementById('previewScaleWrapper'); const content = document.getElementById('previewContent'); scaleWrapper.style.transform = `scale(${currentZoom})`; scaleWrapper.style.width = (content.offsetWidth * currentZoom) + 'px'; scaleWrapper.style.height = (content.offsetHeight * currentZoom) + 'px'; }
function setInitialZoom() { const bodyWrapper = document.getElementById('previewBodyWrapper'); const bodyWidth = bodyWrapper.clientWidth - 20; const a4WidthPx = 210 * 3.779527; if(bodyWidth < a4WidthPx) { currentZoom = bodyWidth / a4WidthPx; } else { currentZoom = 1; } zoomPreview(0); }
function setupPreviewPage(title, contentHtml, contextObj, onEdit, onDelete) { currentPreviewContext = contextObj; document.getElementById('previewPageTitle').innerText = title; document.getElementById('previewContent').innerHTML = contentHtml; const btnEdit = document.getElementById('prevBtnEdit'); const btnDel = document.getElementById('prevBtnDelete'); if(onEdit) { btnEdit.classList.remove('d-none'); btnEdit.onclick = onEdit; } else { btnEdit.classList.add('d-none'); } if(onDelete) { btnDel.classList.remove('d-none'); btnDel.onclick = onDelete; } else { btnDel.classList.add('d-none'); } const btnFilter = document.getElementById('btnOpenFilter'); if (btnFilter) { if (contextObj.type === 'Statement') { btnFilter.classList.remove('d-none'); } else { btnFilter.classList.add('d-none'); } } showView('previewView'); setTimeout(setInitialZoom, 50); }

async function sharePDF() {
    const shareBtn = document.getElementById('prevBtnShare'); const originalText = shareBtn.innerHTML; shareBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>...'; shareBtn.disabled = true;
    try {
        const element = document.getElementById('previewContent'); const filename = `${currentPreviewContext.type}_${currentPreviewContext.id}.pdf`;
        const opt = { margin: 0, filename: filename, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' } };
        const pdfBlob = await html2pdf().set(opt).from(element).output('blob'); const file = new File([pdfBlob], filename, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ title: `${currentPreviewContext.type} ${currentPreviewContext.id}`, text: `Attached is the ${currentPreviewContext.type} for ${currentPreviewContext.clientName}.`, files: [file] }); } 
        else { const link = document.createElement('a'); link.href = URL.createObjectURL(pdfBlob); link.download = filename; link.click(); }
    } catch (err) { console.error("Error sharing PDF:", err); customAlert("Failed to generate PDF."); } finally { shareBtn.innerHTML = originalText; shareBtn.disabled = false; }
}

function printHTML(content) {
    let oldFrame = document.getElementById('printIframe'); if(oldFrame) oldFrame.remove();
    const iframe = document.createElement('iframe'); iframe.id = 'printIframe'; iframe.style.position = 'fixed'; iframe.style.right = '0'; iframe.style.bottom = '0'; iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = 'none'; document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document; doc.open();
    doc.write(`<!DOCTYPE html><html><head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"><style>@media print { @page { size: A4 portrait !important; margin: 10mm !important; } } body { padding: 0; font-family: sans-serif; color: #000; background: #fff; font-size: 12px; } .table-sm th, .table-sm td { padding: 4px 6px !important; } .sign-line { border-top: 1px solid #000; width: 200px; text-align: center; padding-top: 5px; font-weight: 600; margin-top: 40px; }</style></head><body>${content}<script>window.onload = function() { setTimeout(function() { window.print(); }, 300); };<\/script></body></html>`); doc.close();
}

function openInvoicePreview(invId) {
  const inv = loadedData.invoices.find(i => i['Invoice ID'] === invId); const client = loadedData.clients.find(c => c.ID === inv['Client ID']); if(!inv) return;
  let net = parseFloat(inv['Net Amount']) || 0; let paid = inv.paidAmount || 0; let bal = inv.balance || 0;
  let logoSrc = loadedData.company['Logo URL'] || ''; let logoHtml = logoSrc ? `<img src="${logoSrc}" class="d-block mb-2" style="max-height: 55px; width: auto; object-fit: contain;">` : '';
  let items = loadedData.invoiceItems.filter(i => i['Invoice ID'] === invId); let itemsHtml = items.map(i => `<tr><td><strong class="text-dark">${i.Name}</strong><br><span class="text-muted">${i.Description}</span></td><td>${parseFloat(i.Rate).toFixed(2)}</td><td>${i.Quantity}</td><td class="text-end fw-bold">${parseFloat(i.Amount).toFixed(2)}</td></tr>`).join('');
  let contactHtml = client ? `${client['Contact Name'] || ''}<br>${client.Mobile || ''}<br>${client.Email || ''}` : ''; let advanceRow = ''; if (bal < 0) { bal = 0; advanceRow = `<tr class="bg-light text-success"><td><h6 class="mt-2 fw-bold mb-2">Overpaid / Advance</h6></td><td><h6 class="mt-2 fw-bold mb-2">${Math.abs(inv.balance).toFixed(2)}</h6></td></tr>`; }
  
  // Format Due Date for display
  let dueDateHtml = inv['Due Date'] ? `<p class="mb-0"><span class="text-muted fw-bold me-1">Due Date:</span> <span>${inv['Due Date']}</span></p>` : '';

  let html = `<div class="row mb-4 pb-3 border-bottom"><div class="col-7">${logoHtml}<h5 class="fw-bold mb-1 text-dark">${loadedData.company['Company Name'] || ''}</h5><p class="text-muted mb-0" style="white-space: pre-line; line-height: 1.4;">${loadedData.company['Address'] || ''}\n${loadedData.company['Contact'] || ''}</p></div><div class="col-5 text-end"><h2 class="fw-bold" style="color: #4f46e5; letter-spacing: -0.5px;">INVOICE</h2><p class="mb-1"><span class="text-muted fw-bold me-1">Invoice #:</span> <span class="fw-bold">${inv['Invoice Number']}</span></p><p class="mb-0"><span class="text-muted fw-bold me-1">Date:</span> <span>${inv.Date}</span></p>${dueDateHtml}</div></div><div class="row mb-3"><div class="col-12"><p class="text-muted fw-bold mb-1" style="letter-spacing: 0.5px;">BILLED TO</p><h6 class="fw-bold text-dark">${inv['Client Name']}</h6><div class="text-muted" style="line-height: 1.4;">${contactHtml}</div></div></div><table class="table table-sm table-bordered border-dark"><thead style="background-color: #f8fafc;"><tr><th>Description</th><th style="width: 15%;">Rate</th><th style="width: 10%;">Qty</th><th class="text-end" style="width: 20%;">Amount</th></tr></thead><tbody>${itemsHtml}</tbody></table><div class="row"><div class="col-6"></div><div class="col-6"><table class="table table-sm table-borderless text-end mb-0"><tr><td class="text-muted">Subtotal</td><td>${parseFloat(inv['Total Amount']||0).toFixed(2)}</td></tr><tr><td class="text-muted">Discount</td><td>${parseFloat(inv['Discount']||0).toFixed(2)}</td></tr><tr class="border-bottom border-dark"><td class="text-muted">Round Off</td><td>${parseFloat(inv['Round Off']||0).toFixed(2)}</td></tr><tr><td class="fw-bold text-dark pt-2">Net Total</td><td class="fw-bold text-dark pt-2">${net.toFixed(2)}</td></tr><tr><td class="text-muted pb-2">Amount Paid</td><td class="text-success pb-2">${paid.toFixed(2)}</td></tr><tr style="background-color: #f8fafc;"><td><h6 class="mt-2 fw-bold text-dark mb-2">Balance Due</h6></td><td><h6 class="mt-2 fw-bold text-dark mb-2">${bal.toFixed(2)}</h6></td></tr>${advanceRow}</table></div></div><div class="row print-footer align-items-end mt-4 pt-4"><div class="col-7"><p class="text-dark fw-bold mb-1">Terms & Conditions</p><p class="text-muted" style="white-space: pre-line; line-height: 1.4;">${loadedData.company['Terms'] || 'Thank you for your business!'}</p></div><div class="col-5 d-flex justify-content-end"><div class="sign-line">Authorized Signatory</div></div></div>`;
  setupPreviewPage('Invoice Preview', html, { type: 'Invoice', id: inv['Invoice Number'], clientName: inv['Client Name'] }, () => openEditInvoice(invId), () => confirmDelete('invoice', invId));
}

function openReceiptPreview(recId) {
    const rec = loadedData.receipts.find(r => r['Receipt ID'] === recId); const inv = loadedData.invoices.find(i => i['Invoice ID'] === rec['Invoice ID']); const cl = loadedData.clients.find(c => c.ID === rec['Client ID']); if(!rec) return;
    let clientName = inv ? inv['Client Name'] : (cl ? cl.Name : 'Advance Payment'); let logoSrc = loadedData.company['Logo URL'] || ''; let logoHtml = logoSrc ? `<img src="${logoSrc}" class="d-block mb-2" style="max-height: 55px; width: auto; object-fit: contain;">` : '';
    let html = `<div class="row mb-4 pb-3 border-bottom"><div class="col-7">${logoHtml}<h5 class="fw-bold mb-1 text-dark">${loadedData.company['Company Name'] || ''}</h5><p class="text-muted mb-0" style="white-space: pre-line; line-height: 1.4;">${loadedData.company['Address'] || ''}\n${loadedData.company['Contact'] || ''}</p></div><div class="col-5 text-end"><h2 class="fw-bold" style="color: #059669; letter-spacing: -0.5px;">RECEIPT</h2><p class="mb-1"><span class="text-muted fw-bold me-1">Receipt #:</span> <span class="fw-bold">${rec['Receipt ID']}</span></p><p class="mb-0"><span class="text-muted fw-bold me-1">Date:</span> <span>${rec.Date}</span></p></div></div><div class="p-4 bg-light border border-2 border-success rounded my-5 text-center"><h4 class="text-muted mb-2">AMOUNT RECEIVED</h4><h1 class="fw-bold text-success display-4 mb-0">${parseFloat(rec.Amount).toFixed(2)}</h1></div><table class="table table-bordered mt-4"><tbody><tr><td class="w-25 text-muted fw-bold bg-light">Received From</td><td><strong class="fs-5">${clientName}</strong></td></tr><tr><td class="text-muted fw-bold bg-light">Payment Mode</td><td>${rec['Payment Mode']}</td></tr><tr><td class="text-muted fw-bold bg-light">Linked Invoice</td><td>${inv ? inv['Invoice Number'] : 'None (Advance)'}</td></tr></tbody></table><div class="row print-footer mt-5 pt-5"><div class="col-7"></div><div class="col-5 d-flex justify-content-end"><div class="sign-line">Authorized Signatory</div></div></div>`;
    setupPreviewPage('Receipt Preview', html, { type: 'Receipt', id: rec['Receipt ID'], clientName: clientName }, () => openEditReceipt(recId), () => confirmDelete('receipt', recId));
}

// --- STATEMENT PREVIEW LOGIC ---
function openStatement(clientId) { currentStmtClient = loadedData.clients.find(c => c.ID === clientId); if(!currentStmtClient) return; document.getElementById('previewStmtFilter').value = '3m'; document.getElementById('previewCustomDates').classList.add('d-none'); generateStatementPreview(); }
function handlePreviewFilterChange() { const val = document.getElementById('previewStmtFilter').value; if(val === 'custom') { document.getElementById('previewCustomDates').classList.remove('d-none'); } else { document.getElementById('previewCustomDates').classList.add('d-none'); } }
function applyStatementFilter() { const modal = bootstrap.Modal.getInstance(document.getElementById('filterModal')); if (modal) modal.hide(); generateStatementPreview(); }

function generateStatementPreview() {
  if(!currentStmtClient) return; const filter = document.getElementById('previewStmtFilter').value; const now = new Date(); let startDate = new Date(0); let endDate = new Date('2099-01-01');
  if(filter === '3m') startDate = new Date(now.setMonth(now.getMonth() - 3)); else if(filter === '6m') startDate = new Date(now.setMonth(now.getMonth() - 6)); else if(filter === 'ty') startDate = new Date(new Date().getFullYear(), 0, 1); else if(filter === 'ly') { startDate = new Date(new Date().getFullYear() - 1, 0, 1); endDate = new Date(new Date().getFullYear() - 1, 11, 31, 23, 59, 59); } else if(filter === 'custom') { if(document.getElementById('prevStartDate').value) startDate = new Date(document.getElementById('prevStartDate').value); if(document.getElementById('prevEndDate').value) { endDate = new Date(document.getElementById('prevEndDate').value); endDate.setHours(23, 59, 59); } }
  let stmtData = []; loadedData.invoices.forEach(i => { let d = new Date(i.Date); if(i['Client ID'] === currentStmtClient.ID && d >= startDate && d <= endDate) { stmtData.push({ date: d, type: 'Invoice', ref: i['Invoice Number'], amount: parseFloat(i['Net Amount']) }); } }); loadedData.receipts.forEach(r => { let inv = loadedData.invoices.find(i => i['Invoice ID'] === r['Invoice ID']); let d = new Date(r.Date); let isForClient = (inv && inv['Client ID'] === currentStmtClient.ID) || (r['Client ID'] === currentStmtClient.ID); if(isForClient && d >= startDate && d <= endDate) { stmtData.push({ date: d, type: 'Receipt', ref: r['Receipt ID'], amount: -parseFloat(r.Amount) }); } }); stmtData.sort((a, b) => a.date - b.date);
  let tbody = ''; let runTotal = 0; stmtData.forEach(row => { runTotal += row.amount; tbody += `<tr><td>${row.date.toLocaleDateString()}</td><td><span class="badge ${row.type==='Invoice'?'bg-primary':'bg-success'}">${row.type}</span></td><td>${row.ref}</td><td class="text-end ${row.amount < 0 ? 'text-success' : 'text-danger'}">${Math.abs(row.amount).toFixed(2)}</td><td class="text-end fw-bold">${runTotal.toFixed(2)}</td></tr>`; }); if(!tbody) tbody = '<tr><td colspan="5" class="text-center text-muted py-4">No records found for this period.</td></tr>';
  let logoSrc = loadedData.company['Logo URL'] || ''; let logoHtml = logoSrc ? `<img src="${logoSrc}" class="d-block mb-2" style="max-height: 55px; width: auto; object-fit: contain;">` : '';
  let html = `<div class="row mb-4 pb-3 border-bottom"><div class="col-7">${logoHtml}<h5 class="fw-bold mb-1 text-dark">${loadedData.company['Company Name'] || ''}</h5><p class="text-muted mb-0" style="white-space: pre-line; line-height: 1.4;">${loadedData.company['Address'] || ''}\n${loadedData.company['Contact'] || ''}</p></div><div class="col-5 text-end"><h2 class="fw-bold" style="color: #4f46e5; letter-spacing: -0.5px;">STATEMENT</h2><p class="mb-1"><span class="text-muted fw-bold me-1">Client:</span> <span class="fw-bold">${currentStmtClient.Name}</span></p><p class="mb-0"><span class="text-muted fw-bold me-1">Date:</span> <span>${new Date().toLocaleDateString()}</span></p></div></div><table class="table table-bordered table-sm mt-4"><thead class="table-light"><tr><th>Date</th><th>Type</th><th>Ref #</th><th class="text-end">Amount</th><th class="text-end">Balance</th></tr></thead><tbody>${tbody}</tbody></table><h4 class="text-end fw-bold mt-4 border-top pt-3">Final Balance Due: <span class="${runTotal <= 0 ? 'text-success' : 'text-danger'}">${runTotal.toFixed(2)}</span></h4>`;
  setupPreviewPage('Statement Preview', html, { type: 'Statement', id: currentStmtClient.Name.substring(0,6), clientName: currentStmtClient.Name }, null, null );
}

// --- RENDER TABLES WITH LIVE SEARCH AND OVERDUE CHECK ---
function renderTables() {
  renderDashboard(); // Always update dashboard when tables re-render

  const searchInv = document.getElementById('searchInvoices')?.value.toLowerCase() || '';
  const filteredInvoices = loadedData.invoices.filter(i => i['Invoice Number'].toLowerCase().includes(searchInv) || i['Client Name'].toLowerCase().includes(searchInv));
  
  document.getElementById('invoiceTableBody').innerHTML = filteredInvoices.map(i => {
    
    // OVERDUE LOGIC
    let isOverdue = false;
    let dueDateStr = i['Due Date'] || i.dueDate; 
    if(!dueDateStr) { let d = new Date(i.Date); d.setDate(d.getDate() + 15); dueDateStr = d; }
    if(i.balance > 0 && new Date(dueDateStr) < new Date(new Date().setHours(0,0,0,0))) isOverdue = true;

    let status = i.balance <= 0 ? '<span class="badge-paid">Paid</span>' : (isOverdue ? '<span class="badge-due text-white bg-danger">Overdue</span>' : '<span class="badge-due">Due</span>');
    let netAmt = (parseFloat(i['Net Amount']) || 0).toFixed(2); let balText = i.balance > 0 ? `<div class="small fw-bold text-danger">Bal: ${i.balance.toFixed(2)}</div>` : '';
    
    return `<tr onclick="openInvoicePreview('${i['Invoice ID']}')">
      <td class="d-none d-md-table-cell fw-bold text-primary">${i['Invoice Number']}</td>
      <td class="d-none d-md-table-cell text-muted">${i.Date}</td>
      <td class="d-none d-md-table-cell fw-medium">${i['Client Name']}</td>
      <td class="d-none d-md-table-cell text-muted">${netAmt}</td>
      <td class="d-none d-md-table-cell fw-bold">${i.balance > 0 ? i.balance.toFixed(2) : '0.00'}</td>
      <td class="d-none d-md-table-cell">${status}</td>
      <td class="d-none d-md-table-cell text-end text-nowrap">
        ${i.balance > 0 ? `<button class="btn btn-sm btn-light text-success me-1 mb-1" onclick="event.stopPropagation(); openAddReceipt('${i['Invoice ID']}')" title="Record Receipt"><i class="bi bi-cash-stack"></i></button><button class="btn btn-sm btn-light text-success me-1 mb-1" onclick="event.stopPropagation(); sendWhatsAppReminder('${i['Invoice ID']}')" title="Send WhatsApp Reminder"><i class="bi bi-whatsapp"></i></button>` : ''}
        <button class="btn btn-sm btn-light me-1 mb-1" title="View"><i class="bi bi-eye"></i> View</button>
      </td>
      <td class="d-md-none p-0">
        <div class="p-3 pb-2">
            <div class="d-flex justify-content-between mb-1"><span class="fw-bold text-primary">${i['Invoice Number']}</span><span class="text-muted small">${i.Date}</span></div>
            <div class="text-wrap fw-medium small mb-2">${i['Client Name']}</div>
            <div class="d-flex justify-content-between align-items-end"><div><div class="small fw-bold">Amt: ${netAmt}</div>${balText}</div><div>${status}</div></div>
        </div>
        ${i.balance > 0 ? `<div class="d-flex border-top"><button class="btn btn-light w-50 rounded-0 py-2 border-end text-success fw-bold" style="font-size:0.8rem;" onclick="event.stopPropagation(); openAddReceipt('${i['Invoice ID']}')"><i class="bi bi-cash-stack"></i> Receipt</button><button class="btn btn-light w-50 rounded-0 py-2 text-success fw-bold" style="font-size:0.8rem;" onclick="event.stopPropagation(); sendWhatsAppReminder('${i['Invoice ID']}')"><i class="bi bi-whatsapp"></i> Remind</button></div>` : ''}
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="text-center text-muted py-4">No invoices found.</td></tr>';

  const searchCl = document.getElementById('searchClients')?.value.toLowerCase() || '';
  const filteredClients = loadedData.clients.filter(c => c.Name.toLowerCase().includes(searchCl) || (c.Mobile && c.Mobile.includes(searchCl)));
  document.getElementById('clientTableBody').innerHTML = filteredClients.map(c => {
    let balText = c.balanceDue > 0 ? `<span class="text-danger fw-bold">${c.balanceDue.toFixed(2)}</span>` : `<span class="text-success fw-bold">0.00</span>`;
    let contactHTML = ''; if(c['Contact Name'] || c.Mobile) { let n = c['Contact Name'] ? `<i class="bi bi-person"></i> ${c['Contact Name']}` : ''; let m = c.Mobile ? `<i class="bi bi-telephone"></i> ${c.Mobile}` : ''; let sep = (c['Contact Name'] && c.Mobile) ? ' | ' : ''; contactHTML = `<div class="text-muted small mb-1">${n}${sep}${m}</div>`; }
    return `<tr onclick="if(window.innerWidth < 768) showActionModal('client', '${c.ID}')"><td class="d-none d-md-table-cell fw-medium">${c.Name}</td><td class="d-none d-md-table-cell text-muted">${c['Contact Name'] || '-'}</td><td class="d-none d-md-table-cell text-muted">${c.Mobile || '-'}</td><td class="d-none d-md-table-cell fw-bold ${c.balanceDue > 0 ? 'text-danger' : 'text-success'}">${(c.balanceDue||0).toFixed(2)}</td><td class="d-none d-md-table-cell text-end text-nowrap"><button class="btn btn-sm btn-light text-success me-1 mb-1" onclick="event.stopPropagation(); openAddReceipt(null, '${c.ID}')" title="Record Receipt"><i class="bi bi-cash-stack"></i></button><button class="btn btn-sm btn-info text-white me-1 mb-1" onclick="event.stopPropagation(); openStatement('${c.ID}')" title="Statement"><i class="bi bi-journal-text"></i></button><button class="btn btn-sm btn-light mb-1" onclick="event.stopPropagation(); openEditClient('${c.ID}')" title="Edit"><i class="bi bi-pencil"></i></button></td><td class="d-md-none p-3"><div class="text-wrap fw-bold mb-1" style="font-size: 0.95rem;">${c.Name}</div>${contactHTML}<div class="small fw-bold mt-1">Balance: ${balText}</div></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="text-center text-muted py-4">No clients found.</td></tr>';

  const searchSr = document.getElementById('searchServices')?.value.toLowerCase() || '';
  const filteredServices = loadedData.services.filter(s => s.Name.toLowerCase().includes(searchSr));
  document.getElementById('serviceTableBody').innerHTML = filteredServices.map(s => 
    `<tr onclick="if(window.innerWidth < 768) showActionModal('service', '${s.ID}')"><td class="d-none d-md-table-cell fw-medium">${s.Name}</td><td class="d-none d-md-table-cell text-muted">${s.Description || '-'}</td><td class="d-none d-md-table-cell fw-medium">${(parseFloat(s.Rate)||0).toFixed(2)}</td><td class="d-none d-md-table-cell text-end text-nowrap"><button class="btn btn-sm btn-light me-1" onclick="event.stopPropagation(); openEditService('${s.ID}')"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-light text-danger" onclick="event.stopPropagation(); confirmDelete('service', '${s.ID}')"><i class="bi bi-trash"></i></button></td><td class="d-md-none p-3 d-flex justify-content-between align-items-center"><div><div class="fw-bold mb-1">${s.Name}</div><div class="small text-muted">Rate: ${parseFloat(s.Rate).toFixed(2)}</div></div></td></tr>`
  ).join('') || '<tr><td colspan="4" class="text-center text-muted py-4">No services found.</td></tr>';

  const searchRc = document.getElementById('searchReceipts')?.value.toLowerCase() || '';
  const filteredReceipts = loadedData.receipts.filter(r => r['Receipt ID'].toLowerCase().includes(searchRc));
  document.getElementById('receiptTableBody').innerHTML = filteredReceipts.map(r => {
    let inv = loadedData.invoices.find(i => i['Invoice ID'] === r['Invoice ID']); let cl = loadedData.clients.find(c => c.ID === r['Client ID']);
    let clientName = inv ? inv['Client Name'] : (cl ? cl.Name : '-'); let invNum = inv ? inv['Invoice Number'] : 'Advance / Unlinked';
    return `<tr onclick="openReceiptPreview('${r['Receipt ID']}')"><td class="d-none d-md-table-cell fw-bold text-secondary">${r['Receipt ID'] || '-'}</td><td class="d-none d-md-table-cell text-muted">${r.Date}</td><td class="d-none d-md-table-cell fw-medium">${clientName} <br><small class="text-muted">${invNum}</small></td><td class="d-none d-md-table-cell"><span class="badge bg-light text-dark border">${r['Payment Mode']}</span></td><td class="d-none d-md-table-cell fw-bold text-success text-end">+${(parseFloat(r.Amount)||0).toFixed(2)}</td><td class="d-none d-md-table-cell text-end text-nowrap"><button class="btn btn-sm btn-light me-1 mb-1" title="View"><i class="bi bi-eye"></i> View</button></td><td class="d-md-none p-3"><div class="d-flex justify-content-between mb-1"><span class="fw-bold text-secondary">${r['Receipt ID'] || '-'}</span><span class="text-muted small">${r.Date}</span></div><div class="text-wrap fw-medium small mb-2">${clientName}</div><div class="d-flex justify-content-between align-items-end"><div class="fw-bold text-success">+${(parseFloat(r.Amount)||0).toFixed(2)}</div><div><span class="badge bg-light text-dark border">${r['Payment Mode']}</span></div></div></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="text-center text-muted py-4">No receipts found.</td></tr>';
}

// --- CRUD FORMS ---
function openAddClient() { ['c_id','c_name','c_contact','c_email','c_mobile'].forEach(id => document.getElementById(id).value = ''); new bootstrap.Modal(document.getElementById('clientModal')).show(); }
function openEditClient(id) { const c = loadedData.clients.find(x => x.ID === id); document.getElementById('c_id').value = c.ID; document.getElementById('c_name').value = c.Name; document.getElementById('c_contact').value = c['Contact Name']; document.getElementById('c_email').value = c.Email; document.getElementById('c_mobile').value = c.Mobile; new bootstrap.Modal(document.getElementById('clientModal')).show(); }
function saveClient() { const data = ['c_id','c_name','c_contact','c_email','c_mobile'].map(id => document.getElementById(id).value); if(!data[1]) return customAlert("Client name required!"); data[0] ? executeSave('updateClient', ...data) : executeSave('addClient', data[1], data[2], data[3], data[4]); }

function openAddService() { ['s_id','s_name','s_desc','s_rate'].forEach(id => document.getElementById(id).value = ''); new bootstrap.Modal(document.getElementById('serviceModal')).show(); }
function openEditService(id) { const s = loadedData.services.find(x => x.ID === id); document.getElementById('s_id').value = s.ID; document.getElementById('s_name').value = s.Name; document.getElementById('s_desc').value = s.Description; document.getElementById('s_rate').value = s.Rate; new bootstrap.Modal(document.getElementById('serviceModal')).show(); }
function saveService() { const data = ['s_id','s_name','s_desc','s_rate'].map(id => document.getElementById(id).value); if(!data[1] || !data[3]) return customAlert("Name and Rate required!"); data[0] ? executeSave('updateService', ...data) : executeSave('addService', data[1], data[2], data[3]); }

function openAddInvoice() { invoiceItems = []; renderItems(); document.getElementById('inv_id').value = ''; document.getElementById('inv_client').value = ''; document.getElementById('inv_disc').value = '0'; document.getElementById('inv_round').value = '0'; document.getElementById('inv_num').value = loadedData.nextInvoiceNumber || 'INV-TEMP'; document.getElementById('inv_date').valueAsDate = new Date(); autoSetDueDate(); showView('invoiceFormView'); }
function openEditInvoice(invId) { const inv = loadedData.invoices.find(i => i['Invoice ID'] === invId); if(!inv) return; document.getElementById('inv_id').value = invId; document.getElementById('inv_client').value = inv['Client Name']; document.getElementById('inv_date').value = inv.Date; document.getElementById('inv_due_date').value = inv['Due Date'] || inv.dueDate || ''; document.getElementById('inv_num').value = inv['Invoice Number']; document.getElementById('inv_disc').value = inv['Discount']; document.getElementById('inv_round').value = inv['Round Off']; invoiceItems = (loadedData.invoiceItems || []).filter(i => i['Invoice ID'] === invId).map(i => ({ serviceId: i['Service ID'], name: i.Name, description: i.Description, rate: parseFloat(i.Rate)||0, quantity: parseFloat(i.Quantity)||0, amount: parseFloat(i.Amount)||0 })); renderItems(); showView('invoiceFormView'); }
function autoSetDueDate() { let d = document.getElementById('inv_date').valueAsDate; if(d) { d.setDate(d.getDate() + 15); document.getElementById('inv_due_date').valueAsDate = d; } }
function autoFillServiceDetails() { const s = loadedData.services.find(x => x.Name === document.getElementById('item_service').value.trim()); if(s) { document.getElementById('item_rate').value = s.Rate; document.getElementById('item_desc').value = s.Description; } }
function addItem() { const s = loadedData.services.find(x => x.Name === document.getElementById('item_service').value.trim()); if(!s) return customAlert("Select a valid service!"); const q = parseFloat(document.getElementById('item_qty').value); const r = parseFloat(document.getElementById('item_rate').value); if(!q || !r) return; invoiceItems.push({ serviceId: s.ID, name: s.Name, description: document.getElementById('item_desc').value, rate: r, quantity: q, amount: q * r }); ['item_service','item_desc','item_rate'].forEach(id => document.getElementById(id).value = ''); document.getElementById('item_qty').value = '1'; renderItems(); }
function removeItem(index) { invoiceItems.splice(index, 1); renderItems(); }
function renderItems() { let tbody = document.getElementById('itemList'); tbody.innerHTML = ''; let total = 0; invoiceItems.forEach((i, idx) => { tbody.innerHTML += `<tr><td class="text-wrap" style="max-width: 200px;"><div class="fw-bold" style="font-size:0.85rem;">${i.name}</div><div class="text-muted" style="font-size:0.75rem;">${i.description}</div></td><td class="align-middle">${i.rate}</td><td class="align-middle">${i.quantity}</td><td class="text-end fw-medium align-middle">${i.amount.toFixed(2)}</td><td class="text-end align-middle"><button class="btn btn-sm text-danger border-0 bg-transparent" onclick="removeItem(${idx})"><i class="bi bi-trash"></i></button></td></tr>`; total += i.amount; }); document.getElementById('inv_total').value = total.toFixed(2); calculateNet(); }
function calculateNet() { let t = parseFloat(document.getElementById('inv_total').value) || 0; let d = parseFloat(document.getElementById('inv_disc').value) || 0; let r = parseFloat(document.getElementById('inv_round').value) || 0; document.getElementById('inv_net').value = (t - d + r).toFixed(2); }
function saveInvoice() { const invId = document.getElementById('inv_id').value; const client = loadedData.clients.find(c => c.Name === document.getElementById('inv_client').value.trim()); if(!client) return customAlert("Select a valid client!"); if(invoiceItems.length === 0) return customAlert("Add at least one item!"); const invData = { clientId: client.ID, clientName: client.Name, date: document.getElementById('inv_date').value, dueDate: document.getElementById('inv_due_date').value, invNum: document.getElementById('inv_num').value, totalAmount: document.getElementById('inv_total').value, discount: document.getElementById('inv_disc').value, roundOff: document.getElementById('inv_round').value, netAmount: document.getElementById('inv_net').value }; if(invId) executeSave('updateInvoice', invId, invData, invoiceItems); else executeSave('addInvoice', invData, invoiceItems); showView('dashboardView'); }

function generateReceiptNum() { if(!loadedData.receipts || loadedData.receipts.length === 0) return "REC-0001"; let max = 0; loadedData.receipts.forEach(r => { let match = String(r['Receipt ID']).match(/(\d+)$/); if(match && parseInt(match[1]) > max) max = parseInt(match[1]); }); return "REC-" + (max + 1).toString().padStart(4, '0'); }
function filterInvoicesForReceipt() { let clientName = document.getElementById('rec_client_input').value.trim(); let clientObj = loadedData.clients.find(c => c.Name === clientName); let sel = document.getElementById('rec_invoice'); sel.innerHTML = '<option value="">None (Advance Payment)</option>'; document.getElementById('rec_client_id').value = clientObj ? clientObj.ID : ''; if(!clientObj) return; loadedData.invoices.filter(i => i['Client ID'] === clientObj.ID && i.balance > 0).forEach(inv => { sel.innerHTML += `<option value="${inv['Invoice ID']}">${inv['Invoice Number']} (Bal: ${inv.balance.toFixed(2)})</option>`; }); }
function openAddReceipt(forceInvId = null, forceClientId = null) { document.getElementById('r_id').value = ''; document.getElementById('rec_num').value = generateReceiptNum(); document.getElementById('rec_client_input').value = ''; if(forceInvId) { let inv = loadedData.invoices.find(i => i['Invoice ID'] === forceInvId); document.getElementById('rec_client_input').value = inv['Client Name']; filterInvoicesForReceipt(); document.getElementById('rec_invoice').value = forceInvId; document.getElementById('rec_client_input').disabled = true; document.getElementById('rec_client_clear').disabled = true; document.getElementById('rec_invoice').disabled = true; } else if (forceClientId) { let cl = loadedData.clients.find(c => c.ID === forceClientId); document.getElementById('rec_client_input').value = cl.Name; filterInvoicesForReceipt(); document.getElementById('rec_invoice').value = ''; document.getElementById('rec_client_input').disabled = true; document.getElementById('rec_client_clear').disabled = true; document.getElementById('rec_invoice').disabled = false; } else { document.getElementById('rec_client_input').disabled = false; document.getElementById('rec_client_clear').disabled = false; document.getElementById('rec_invoice').disabled = false; filterInvoicesForReceipt(); } document.getElementById('rec_date').valueAsDate = new Date(); document.getElementById('rec_amount').value = ''; document.getElementById('receiptModalTitle').innerText = 'Record Receipt'; new bootstrap.Modal(document.getElementById('receiptModal')).show(); }
function openEditReceipt(recId) { const rec = loadedData.receipts.find(r => r['Receipt ID'] === recId); if(!rec) return; document.getElementById('r_id').value = rec['Receipt ID']; document.getElementById('rec_num').value = rec['Receipt ID']; const client = loadedData.clients.find(c => c.ID === rec['Client ID']); document.getElementById('rec_client_input').value = client ? client.Name : ''; filterInvoicesForReceipt(); document.getElementById('rec_invoice').value = rec['Invoice ID'] || ''; document.getElementById('rec_client_input').disabled = true; document.getElementById('rec_client_clear').disabled = true; document.getElementById('rec_invoice').disabled = true; document.getElementById('rec_date').value = rec.Date; document.getElementById('rec_amount').value = rec.Amount; document.getElementById('rec_mode').value = rec['Payment Mode']; document.getElementById('receiptModalTitle').innerText = 'Edit Receipt'; new bootstrap.Modal(document.getElementById('receiptModal')).show(); }
function saveReceipt() { const rid = document.getElementById('r_id').value; const rNum = document.getElementById('rec_num').value; const clientId = document.getElementById('rec_client_id').value; const invId = document.getElementById('rec_invoice').value; const amt = document.getElementById('rec_amount').value; if(!clientId || !amt || !rNum) return customAlert("Client, Amount, and Receipt Number required!"); if(rid) executeSave('updateReceipt', rid, invId, document.getElementById('rec_date').value, amt, document.getElementById('rec_mode').value, rNum, clientId); else executeSave('addReceipt', invId, document.getElementById('rec_date').value, amt, document.getElementById('rec_mode').value, rNum, clientId); showView('dashboardView');}

window.onload = loadApp;
