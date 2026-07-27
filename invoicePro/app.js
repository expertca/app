// ====== IMPORTANT: PASTE YOUR GOOGLE WEB APP URL HERE ======
const API_URL = "https://script.google.com/macros/s/AKfycbw5nV8VCp3w_gmVck3MjYzG8vEegFLESFM8RB0PA5bb5rtocmDDn3O8fM0iolY-XCYQ/exec";
let loadedData = { company: {}, clients: [], services: [], invoices: [], receipts: [], invoiceItems: [] };
let invoiceItems = [];
let currentStmtClient = null;
let currentPreviewContext = {}; 
let revenueChartInstance = null; 

let currentClientDashboardId = null;
let lastMainView = 'dashboardView'; 

function generateUID(prefix) { return prefix + '-' + Math.random().toString(36).substring(2, 8).toUpperCase(); }

function customAlert(message) { 
    document.getElementById('alertMessage').innerText = message; 
    new bootstrap.Modal(document.getElementById('alertModal')).show(); 
}

function confirmDelete(type, id) {
    document.getElementById('confirmMessage').innerText = `Delete this ${type}?\nLinked records will also be removed.`;
    const confirmModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('confirmModal'));
    document.getElementById('confirmBtnYes').onclick = () => {
        confirmModal.hide();
        executeSave('deleteRecord', type, id);
        if(type === 'client' && String(id) === String(currentClientDashboardId)) {
            showView('dashboardView');
        } else {
            showView(lastMainView);
        }
    };
    confirmModal.show();
}

function showView(viewId) {
    if(viewId === 'dashboardView' || viewId === 'clientDashboardView') {
        lastMainView = viewId;
    }
    document.querySelectorAll('.app-view').forEach(v => v.classList.add('d-none'));
    document.getElementById(viewId).classList.remove('d-none');
    window.scrollTo(0, 0);
}

window.addEventListener('scroll', () => {
    const view = document.getElementById('clientDashboardView');
    if (!view.classList.contains('d-none')) {
        const details = document.getElementById('cd_clientDetails');
        if (window.scrollY > 40) { details.classList.add('hide-on-scroll'); } 
        else if (window.scrollY <= 10) { details.classList.remove('hide-on-scroll'); }
    }
});

async function importContact() {
    const props = ['name', 'email', 'tel'];
    try {
        const contacts = await navigator.contacts.select(props, { multiple: false });
        if (contacts.length > 0) {
            const c = contacts[0];
            if (c.name && c.name.length > 0) { document.getElementById('c_name').value = c.name[0]; document.getElementById('c_contact').value = c.name[0]; }
            if (c.tel && c.tel.length > 0) { document.getElementById('c_mobile').value = c.tel[0].replace(/[^\d+]/g, ''); }
            if (c.email && c.email.length > 0) { document.getElementById('c_email').value = c.email[0]; }
        }
    } catch (ex) { console.log('Contact picker error:', ex); }
}

let db;
function initDB(callback) { 
    let req = window.indexedDB.open('InvoiceProDB', 1); 
    req.onupgradeneeded = e => { 
        db = e.target.result; 
        if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'id' }); 
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' }); 
    }; 
    req.onsuccess = e => { db = e.target.result; if(callback) callback(); }; 
    req.onerror = () => { if(callback) callback(); }; 
}

function updateSyncStatus(status) { 
    const badges = document.querySelectorAll('.sync-badge'); 
    badges.forEach(badge => { 
        if(status === 'Synced') { badge.className = 'badge bg-success sync-badge'; badge.innerText = 'Synced'; } 
        else if(status === 'Offline') { badge.className = 'badge bg-warning text-dark sync-badge'; badge.innerText = 'Offline Mode'; } 
        else if(status === 'Pending') { badge.className = 'badge bg-danger sync-badge'; badge.innerText = 'Pending Sync'; } 
        else { badge.className = 'badge bg-primary sync-badge'; badge.innerText = 'Syncing...'; } 
    }); 
}

function saveLocalCache(data) { 
    try { localStorage.setItem('InvoiceProCache', JSON.stringify(data)); } catch(e){} 
    if(db) { try { let tx = db.transaction('cache', 'readwrite'); tx.objectStore('cache').put({ key: 'loadedData', data: data }); } catch(e){} } 
}

function loadLocalCache(callback) { 
    let hasCache = false; 
    try { 
        const cached = localStorage.getItem('InvoiceProCache'); 
        if (cached) { loadedData = JSON.parse(cached); calculateBalances(); renderTables(); populateDropdowns(); hasCache = true; } 
    } catch(e){} 
    if(callback) callback(hasCache); 
}

async function apiCall(action, ...params) { 
    const response = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: action, params: params }) }); 
    const result = await response.json(); 
    if(!result.success) throw new Error(result.error); 
    return result.data; 
}

window.onload = () => { showView('dashboardView'); loadApp(); };

function loadApp() {
  initDB(() => {
    loadLocalCache((hasCache) => {
      if(hasCache) { document.getElementById('loaderOverlay').classList.add('d-none'); }
      if(!navigator.onLine) { updateSyncStatus('Offline'); document.getElementById('loaderOverlay').classList.add('d-none'); return; }
      updateSyncStatus('Syncing...');
      apiCall('getInitialData').then(data => { 
          loadedData = data || { company: {}, clients: [], services: [], invoices: [], receipts: [], invoiceItems: [] }; 
          saveLocalCache(loadedData); calculateBalances(); renderTables(); populateDropdowns(); 
          updateSyncStatus('Synced'); document.getElementById('loaderOverlay').classList.add('d-none'); 
          processQueue(); 
      }).catch(err => { updateSyncStatus('Offline'); document.getElementById('loaderOverlay').classList.add('d-none'); });
    });
  });
  if ('contacts' in navigator && 'ContactsManager' in window) {
      const importBtn = document.getElementById('btnImportContact');
      if (importBtn) importBtn.classList.remove('d-none');
  }
}

window.addEventListener('online', () => { updateSyncStatus('Syncing...'); loadApp(); }); 
window.addEventListener('offline', () => updateSyncStatus('Offline'));

function saveToQueue(action, params) { if(!db) return; try { let tx = db.transaction('syncQueue', 'readwrite'); tx.objectStore('syncQueue').add({ id: Date.now().toString(), action: action, params: params }); updateSyncStatus('Pending'); } catch(e){} }
function processQueue() { if (!navigator.onLine || !db) return; try { let tx = db.transaction('syncQueue', 'readonly'); let req = tx.objectStore('syncQueue').getAll(); req.onsuccess = () => { let queue = req.result; if (queue.length === 0) return; updateSyncStatus('Syncing...'); let item = queue[0]; apiCall(item.action, ...item.params).then(() => { let dTx = db.transaction('syncQueue', 'readwrite'); dTx.objectStore('syncQueue').delete(item.id); dTx.oncomplete = () => processQueue(); }).catch(() => updateSyncStatus('Offline')); }; } catch(e){} }
function executeSave(action, ...params) { optimisticUpdate(action, params); if (!navigator.onLine) { saveToQueue(action, params); return; } updateSyncStatus('Syncing...'); apiCall(action, ...params).then(() => { loadApp(); }).catch(() => { saveToQueue(action, params); }); }

function optimisticUpdate(action, params) {
  try {
      let m = document.querySelector('.modal.show'); 
      if(m) {
          let inst = bootstrap.Modal.getInstance(m);
          if(inst) { inst.hide(); } else { m.classList.remove('show'); m.style.display = 'none'; document.body.classList.remove('modal-open'); document.body.style = ''; }
          const backdrop = document.querySelector('.modal-backdrop');
          if (backdrop) backdrop.remove();
      }
  } catch (e) {}

  if(action === 'addClient') loadedData.clients.push({ ID: params[0], Name: params[1], 'Contact Name': params[2], Email: params[3], Mobile: params[4] });
  else if(action === 'addService') loadedData.services.push({ ID: params[0], Name: params[1], Description: params[2], Rate: params[3] });
  else if(action === 'addInvoice') { 
      let tId = params[0].id;
      loadedData.invoices.push({ 'Invoice ID': tId, 'Client ID': params[0].clientId, 'Client Name': params[0].clientName, Date: params[0].date, 'Due Date': params[0].dueDate, 'Invoice Number': params[0].invNum, 'Total Amount': params[0].totalAmount, 'Discount': params[0].discount, 'Round Off': params[0].roundOff, 'Net Amount': params[0].netAmount }); 
      if(params[1]) params[1].forEach(item => { loadedData.invoiceItems.push({ 'Invoice ID': tId, 'Service ID': item.serviceId, 'Name': item.name, 'Description': item.description, 'Rate': item.rate, 'Quantity': item.quantity, 'Amount': item.amount }); });
  }
  else if(action === 'updateClient') {
      let idx = loadedData.clients.findIndex(c => String(c.ID) === String(params[0]));
      if(idx > -1) { loadedData.clients[idx].Name = params[1]; loadedData.clients[idx]['Contact Name'] = params[2]; loadedData.clients[idx].Email = params[3]; loadedData.clients[idx].Mobile = params[4]; }
  }
  else if(action === 'updateService') {
      let idx = loadedData.services.findIndex(s => String(s.ID) === String(params[0]));
      if(idx > -1) { loadedData.services[idx].Name = params[1]; loadedData.services[idx].Description = params[2]; loadedData.services[idx].Rate = params[3]; }
  }
  else if(action === 'updateInvoice') {
      let idx = loadedData.invoices.findIndex(i => String(i['Invoice ID']) === String(params[0]));
      if(idx > -1) {
          loadedData.invoices[idx]['Client ID'] = params[1].clientId; loadedData.invoices[idx]['Client Name'] = params[1].clientName; loadedData.invoices[idx].Date = params[1].date; loadedData.invoices[idx]['Due Date'] = params[1].dueDate; loadedData.invoices[idx]['Invoice Number'] = params[1].invNum; loadedData.invoices[idx]['Total Amount'] = params[1].totalAmount; loadedData.invoices[idx]['Discount'] = params[1].discount; loadedData.invoices[idx]['Round Off'] = params[1].roundOff; loadedData.invoices[idx]['Net Amount'] = params[1].netAmount;
      }
      loadedData.invoiceItems = loadedData.invoiceItems.filter(i => String(i['Invoice ID']) !== String(params[0]));
      params[2].forEach(item => { loadedData.invoiceItems.push({ 'Invoice ID': params[0], 'Service ID': item.serviceId, 'Name': item.name, 'Description': item.description, 'Rate': item.rate, 'Quantity': item.quantity, 'Amount': item.amount }); });
  }
  else if(action === 'addReceiptBatch') {
      params[0].forEach(r => { loadedData.receipts.push({ 'Receipt ID': r.recId, 'Invoice ID': r.invId, Date: r.date, Amount: r.amount, 'Payment Mode': r.mode, 'Client ID': r.clientId }); });
  }
  else if(action === 'updateReceiptBatch') {
      loadedData.receipts = loadedData.receipts.filter(r => String(r['Receipt ID']) !== String(params[0]));
      params[1].forEach(r => { loadedData.receipts.push({ 'Receipt ID': r.recId, 'Invoice ID': r.invId, Date: r.date, Amount: r.amount, 'Payment Mode': r.mode, 'Client ID': r.clientId }); });
  }
  else if (action === 'deleteRecord') {
    let type = params[0]; let id = String(params[1]);
    if(type === 'client') { loadedData.clients = loadedData.clients.filter(c => String(c.ID) !== id); let invIds = loadedData.invoices.filter(i => String(i['Client ID']) === id).map(i => i['Invoice ID']); loadedData.invoices = loadedData.invoices.filter(i => String(i['Client ID']) !== id); loadedData.receipts = loadedData.receipts.filter(r => !invIds.includes(r['Invoice ID']) && String(r['Client ID']) !== id); }
    else if(type === 'invoice') { loadedData.invoices = loadedData.invoices.filter(i => String(i['Invoice ID']) !== id); loadedData.receipts = loadedData.receipts.filter(r => String(r['Invoice ID']) !== id); loadedData.invoiceItems = loadedData.invoiceItems.filter(i => String(i['Invoice ID']) !== id); }
    else if(type === 'service') { loadedData.services = loadedData.services.filter(s => String(s.ID) !== id); }
    else if(type === 'receipt') { loadedData.receipts = loadedData.receipts.filter(r => String(r['Receipt ID']) !== id); }
  }
  
  saveLocalCache(loadedData); calculateBalances(); renderTables(); populateDropdowns();
}

// UI HELPER: Visually merges split rows sharing the same Receipt ID back into one object
function getMergedReceiptsList(receiptsArray) {
    let merged = {};
    receiptsArray.forEach(r => {
        let id = r['Receipt ID'];
        if(!merged[id]) { merged[id] = { ...r, Amount: 0, linkedInvoicesSet: new Set() }; }
        merged[id].Amount += (parseFloat(r.Amount) || 0);
        if(r['Invoice ID']) merged[id].linkedInvoicesSet.add(r['Invoice ID']);
    });
    
    return Object.values(merged).map(m => {
        let invNums = Array.from(m.linkedInvoicesSet).map(invId => {
            let inv = loadedData.invoices.find(i => String(i['Invoice ID']) === String(invId));
            return inv ? inv['Invoice Number'] : null;
        }).filter(Boolean);
        m.displayInvRef = invNums.length > 0 ? invNums.join(', ') : 'Advance / Unlinked';
        return m;
    }).sort((a,b) => new Date(b.Date) - new Date(a.Date));
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

function renderDashboard() {
    let totalDue = 0; let totalRevThisYear = 0; let overdueCount = 0;
    const now = new Date(); const currentYear = now.getFullYear();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    let monthlyData = {};
    for(let i=5; i>=0; i--) {
        let d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthlyData[d.toLocaleString('default', { month: 'short' })] = 0;
    }

    loadedData.invoices.forEach(inv => {
        if(inv.balance > 0) totalDue += inv.balance;
        let invDate = new Date(inv.Date);
        if(invDate.getFullYear() === currentYear) totalRevThisYear += (parseFloat(inv['Net Amount']) || 0);
        if(invDate >= sixMonthsAgo) {
            let monthName = invDate.toLocaleString('default', { month: 'short' });
            if(monthlyData[monthName] !== undefined) monthlyData[monthName] += (parseFloat(inv['Net Amount']) || 0);
        }
        let dueDateStr = inv['Due Date'] || inv.dueDate; 
        if(!dueDateStr) { let d = new Date(invDate); d.setDate(d.getDate() + 15); dueDateStr = d; }
        if(inv.balance > 0 && new Date(dueDateStr) < new Date(now.setHours(0,0,0,0))) overdueCount++;
    });

    document.getElementById('dashTotalDue').innerText = '₹' + totalDue.toFixed(2);
    document.getElementById('dashTotalRev').innerText = '₹' + totalRevThisYear.toFixed(2);
    document.getElementById('dashOverdueCount').innerText = overdueCount;

    const ctx = document.getElementById('revenueChart');
    if(ctx) {
        if(revenueChartInstance) revenueChartInstance.destroy(); 
        revenueChartInstance = new Chart(ctx, {
            type: 'bar',
            data: { labels: Object.keys(monthlyData), datasets: [{ label: 'Revenue (₹)', data: Object.values(monthlyData), backgroundColor: '#4f46e5', borderRadius: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { display: false } }, x: { grid: { display: false } } } }
        });
    }

    let activity = [];
    loadedData.invoices.forEach(i => activity.push({ date: new Date(i.Date), text: `Created Invoice <b>${i['Invoice Number']}</b> for ${i['Client Name']} (₹${i['Net Amount']})`, icon: 'bi-file-earmark-text', color: 'text-primary' }));
    
    // Merge activities to prevent UI spam from splits
    let mergedAll = getMergedReceiptsList(loadedData.receipts);
    mergedAll.forEach(r => { let cl = loadedData.clients.find(c => String(c.ID) === String(r['Client ID'])); let cName = cl ? cl.Name : 'Unknown'; activity.push({ date: new Date(r.Date), text: `Received <b>₹${r.Amount}</b> from ${cName}`, icon: 'bi-cash-stack', color: 'text-success' }); });
    
    activity.sort((a,b) => b.date - a.date); 
    let feedHtml = activity.slice(0, 10).map(a => `<div class="d-flex mb-3"><div class="me-3 ${a.color}"><i class="bi ${a.icon} fs-5"></i></div><div><div class="small">${a.text}</div><div class="text-muted" style="font-size:0.7rem;">${a.date.toLocaleDateString()}</div></div></div>`).join('');
    document.getElementById('dashRecentActivity').innerHTML = feedHtml || '<p class="text-muted small">No recent activity.</p>';
}

function sendWhatsAppReminder(invId) {
    const inv = loadedData.invoices.find(i => i['Invoice ID'] === invId);
    const client = loadedData.clients.find(c => c.ID === inv['Client ID']);
    if(!client || !client.Mobile) return customAlert("No mobile number saved for this client.");
    const phone = client.Mobile.replace(/[^\d]/g, '');
    const text = `Hello ${inv['Client Name']},\n\nA gentle reminder that Invoice *${inv['Invoice Number']}* has a pending balance of *₹${inv.balance.toFixed(2)}*.\n\nPlease let us know when this can be cleared. Thank you!`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
}

let currentZoom = 1;
function zoomPreview(delta) { 
    currentZoom += delta; if(currentZoom < 0.3) currentZoom = 0.3; if(currentZoom > 2.5) currentZoom = 2.5; 
    const scaleWrapper = document.getElementById('previewScaleWrapper'); const content = document.getElementById('previewContent'); 
    scaleWrapper.style.transform = `scale(${currentZoom})`; scaleWrapper.style.width = (content.offsetWidth * currentZoom) + 'px'; scaleWrapper.style.height = (content.offsetHeight * currentZoom) + 'px'; 
}

function setInitialZoom() { 
    const bodyWrapper = document.getElementById('previewBodyWrapper'); const bodyWidth = bodyWrapper.clientWidth - 20; const a4WidthPx = 210 * 3.779527; 
    if(bodyWidth < a4WidthPx) { currentZoom = bodyWidth / a4WidthPx; } else { currentZoom = 1; } 
    zoomPreview(0); 
}

function setupPreviewPage(title, contentHtml, contextObj, onEdit, onDelete) { 
    currentPreviewContext = contextObj; document.getElementById('previewPageTitle').innerText = title; document.getElementById('previewContent').innerHTML = contentHtml; 
    const btnEdit = document.getElementById('prevBtnEdit'); const btnDel = document.getElementById('prevBtnDelete'); 
    if(onEdit) { btnEdit.classList.remove('d-none'); btnEdit.onclick = onEdit; } else { btnEdit.classList.add('d-none'); } 
    if(onDelete) { btnDel.classList.remove('d-none'); btnDel.onclick = onDelete; } else { btnDel.classList.add('d-none'); } 
    const btnFilter = document.getElementById('btnOpenFilter'); 
    if (btnFilter) { if (contextObj.type === 'Statement') { btnFilter.classList.remove('d-none'); } else { btnFilter.classList.add('d-none'); } } 
    showView('previewView'); setTimeout(setInitialZoom, 50); 
}

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
  const inv = loadedData.invoices.find(i => String(i['Invoice ID']) === String(invId)); const client = loadedData.clients.find(c => String(c.ID) === String(inv['Client ID'])); if(!inv) return;
  let net = parseFloat(inv['Net Amount']) || 0; let paid = inv.paidAmount || 0; let bal = inv.balance || 0;
  let logoSrc = loadedData.company['Logo URL'] || ''; let logoHtml = logoSrc ? `<img src="${logoSrc}" class="d-block mb-2" style="max-height: 55px; width: auto; object-fit: contain;">` : '';
  let items = loadedData.invoiceItems.filter(i => String(i['Invoice ID']) === String(invId)); let itemsHtml = items.map(i => `<tr><td><strong class="text-dark">${i.Name}</strong><br><span class="text-muted">${i.Description}</span></td><td>${parseFloat(i.Rate).toFixed(2)}</td><td>${i.Quantity}</td><td class="text-end fw-bold">${parseFloat(i.Amount).toFixed(2)}</td></tr>`).join('');
  let contactHtml = client ? `${client['Contact Name'] || ''}<br>${(client.Mobile ? String(client.Mobile).replace(/^'/, '') : '')}<br>${client.Email || ''}` : ''; let advanceRow = ''; if (bal < 0) { bal = 0; advanceRow = `<tr class="bg-light text-success"><td><h6 class="mt-2 fw-bold mb-2">Overpaid / Advance</h6></td><td><h6 class="mt-2 fw-bold mb-2">${Math.abs(inv.balance).toFixed(2)}</h6></td></tr>`; }
  
  let dueDateHtml = inv['Due Date'] ? `<p class="mb-0"><span class="text-muted fw-bold me-1">Due Date:</span> <span>${inv['Due Date'].substring(0, 10)}</span></p>` : '';

  let html = `<div class="row mb-4 pb-3 border-bottom"><div class="col-7">${logoHtml}<h5 class="fw-bold mb-1 text-dark">${loadedData.company['Company Name'] || ''}</h5><p class="text-muted mb-0" style="white-space: pre-line; line-height: 1.4;">${loadedData.company['Address'] || ''}\n${loadedData.company['Contact'] || ''}</p></div><div class="col-5 text-end"><h2 class="fw-bold" style="color: #4f46e5; letter-spacing: -0.5px;">INVOICE</h2><p class="mb-1"><span class="text-muted fw-bold me-1">Invoice #:</span> <span class="fw-bold">${inv['Invoice Number']}</span></p><p class="mb-0"><span class="text-muted fw-bold me-1">Date:</span> <span>${inv.Date.substring(0, 10)}</span></p>${dueDateHtml}</div></div><div class="row mb-3"><div class="col-12"><p class="text-muted fw-bold mb-1" style="letter-spacing: 0.5px;">BILLED TO</p><h6 class="fw-bold text-dark">${inv['Client Name']}</h6><div class="text-muted" style="line-height: 1.4;">${contactHtml}</div></div></div><table class="table table-sm table-bordered border-dark"><thead style="background-color: #f8fafc;"><tr><th>Description</th><th style="width: 15%;">Rate</th><th style="width: 10%;">Qty</th><th class="text-end" style="width: 20%;">Amount</th></tr></thead><tbody>${itemsHtml}</tbody></table><div class="row"><div class="col-6"></div><div class="col-6"><table class="table table-sm table-borderless text-end mb-0"><tr><td class="text-muted">Subtotal</td><td>${parseFloat(inv['Total Amount']||0).toFixed(2)}</td></tr><tr><td class="text-muted">Discount</td><td>${parseFloat(inv['Discount']||0).toFixed(2)}</td></tr><tr class="border-bottom border-dark"><td class="text-muted">Round Off</td><td>${parseFloat(inv['Round Off']||0).toFixed(2)}</td></tr><tr><td class="fw-bold text-dark pt-2">Net Total</td><td class="fw-bold text-dark pt-2">${net.toFixed(2)}</td></tr><tr><td class="text-muted pb-2">Amount Paid</td><td class="text-success pb-2">${paid.toFixed(2)}</td></tr><tr style="background-color: #f8fafc;"><td><h6 class="mt-2 fw-bold text-dark mb-2">Balance Due</h6></td><td><h6 class="mt-2 fw-bold text-dark mb-2">${bal.toFixed(2)}</h6></td></tr>${advanceRow}</table></div></div><div class="row print-footer align-items-end mt-4 pt-4"><div class="col-7"><p class="text-dark fw-bold mb-1">Terms & Conditions</p><p class="text-muted" style="white-space: pre-line; line-height: 1.4;">${loadedData.company['Terms'] || 'Thank you for your business!'}</p></div><div class="col-5 d-flex justify-content-end"><div class="sign-line">Authorized Signatory</div></div></div>`;
  setupPreviewPage('Invoice Preview', html, { type: 'Invoice', id: inv['Invoice Number'], clientName: inv['Client Name'] }, () => openEditInvoice(invId), () => confirmDelete('invoice', invId));
}

// FIXED: UI PDF Template now handles visually grouped split receipts perfectly
function openReceiptPreview(recId) {
    let matchingRecs = loadedData.receipts.filter(r => String(r['Receipt ID']) === String(recId));
    if (matchingRecs.length === 0) return;
    
    let totalAmt = matchingRecs.reduce((sum, r) => sum + (parseFloat(r.Amount) || 0), 0);
    let firstRec = matchingRecs[0];
    let cl = loadedData.clients.find(c => String(c.ID) === String(firstRec['Client ID']));
    let clientName = cl ? cl.Name : 'Advance Payment';
    
    let linkedInvIds = matchingRecs.map(r => r['Invoice ID']).filter(Boolean);
    let linkedInvNums = linkedInvIds.map(id => {
        let inv = loadedData.invoices.find(i => String(i['Invoice ID']) === String(id));
        return inv ? inv['Invoice Number'] : null;
    }).filter(Boolean);
    
    let invRefsDisplay = linkedInvNums.length > 0 ? linkedInvNums.join(', ') : 'None (Advance)';
    
    let logoSrc = loadedData.company['Logo URL'] || ''; let logoHtml = logoSrc ? `<img src="${logoSrc}" class="d-block mb-2" style="max-height: 55px; width: auto; object-fit: contain;">` : '';
    let html = `<div class="row mb-4 pb-3 border-bottom"><div class="col-7">${logoHtml}<h5 class="fw-bold mb-1 text-dark">${loadedData.company['Company Name'] || ''}</h5><p class="text-muted mb-0" style="white-space: pre-line; line-height: 1.4;">${loadedData.company['Address'] || ''}\n${loadedData.company['Contact'] || ''}</p></div><div class="col-5 text-end"><h2 class="fw-bold" style="color: #059669; letter-spacing: -0.5px;">RECEIPT</h2><p class="mb-1"><span class="text-muted fw-bold me-1">Receipt #:</span> <span class="fw-bold">${firstRec['Receipt ID']}</span></p><p class="mb-0"><span class="text-muted fw-bold me-1">Date:</span> <span>${firstRec.Date.substring(0, 10)}</span></p></div></div><div class="p-4 bg-light border border-2 border-success rounded my-5 text-center"><h4 class="text-muted mb-2">AMOUNT RECEIVED</h4><h1 class="fw-bold text-success display-4 mb-0">${totalAmt.toFixed(2)}</h1></div><table class="table table-bordered mt-4"><tbody><tr><td class="w-25 text-muted fw-bold bg-light">Received From</td><td><strong class="fs-5">${clientName}</strong></td></tr><tr><td class="text-muted fw-bold bg-light">Payment Mode</td><td>${firstRec['Payment Mode']}</td></tr><tr><td class="text-muted fw-bold bg-light">${linkedInvNums.length > 1 ? 'Linked Invoices' : 'Linked Invoice'}</td><td>${invRefsDisplay}</td></tr></tbody></table><div class="row print-footer mt-5 pt-5"><div class="col-7"></div><div class="col-5 d-flex justify-content-end"><div class="sign-line">Authorized Signatory</div></div></div>`;
    setupPreviewPage('Receipt Preview', html, { type: 'Receipt', id: firstRec['Receipt ID'], clientName: clientName }, () => openEditReceipt(recId), () => confirmDelete('receipt', recId));
}

let cdCurrentFilter = '3m';

function openClientDashboard(clientId) {
    currentClientDashboardId = clientId;
    const c = loadedData.clients.find(x => String(x.ID) === String(clientId));
    if(!c) return showView('dashboardView');
    
    let contactHTML = ''; 
    if(c['Contact Name']) contactHTML += `<div><i class="bi bi-person text-muted me-2"></i> ${c['Contact Name']}</div>`;
    if(c.Mobile) contactHTML += `<div><i class="bi bi-telephone text-muted me-2"></i> ${String(c.Mobile).replace(/^'/, '')}</div>`;
    if(c.Email) contactHTML += `<div><i class="bi bi-envelope text-muted me-2"></i> ${c.Email}</div>`;
    
    let balClass = c.balanceDue > 0 ? 'text-danger' : 'text-success';
    
    document.getElementById('cd_clientDetails').innerHTML = `
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-3">
            <div>
                <h3 class="fw-bold mb-2 text-dark">${c.Name}</h3>
                <div class="text-muted small d-flex flex-column gap-1">${contactHTML || 'No contact details provided.'}</div>
            </div>
            <div class="text-end text-md-start bg-light p-3 rounded border">
                <div class="text-muted small fw-bold text-uppercase mb-1">Total Balance Due</div>
                <h4 class="fw-bold mb-0 ${balClass}">₹${(c.balanceDue||0).toFixed(2)}</h4>
            </div>
        </div>
    `;
    
    document.getElementById('cd_editBtn').onclick = () => openEditClient(clientId);
    document.getElementById('cd_recordReceiptBtn').onclick = () => openAddReceipt(null, clientId);
    document.getElementById('cd_statementBtn').onclick = () => openStatement(clientId);
    
    document.getElementById('cd_customDates').classList.add('d-none');
    document.getElementById('cd_customDates').classList.remove('d-flex');
    cdCurrentFilter = '3m';
    
    renderClientDashboard();
    showView('clientDashboardView');
}

function setCdFilter(val) {
    cdCurrentFilter = val;
    document.getElementById('cd_customDates').classList.add('d-none');
    document.getElementById('cd_customDates').classList.remove('d-flex');
    renderClientDashboard();
}

function renderClientDashboard() {
    if(!currentClientDashboardId) return;
    const now = new Date(); 
    let startDate = new Date(0); 
    let endDate = new Date('2099-01-01');
    
    if(cdCurrentFilter === '3m') startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); 
    else if(cdCurrentFilter === '6m') startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); 
    else if(cdCurrentFilter === 'ty') startDate = new Date(now.getFullYear(), 0, 1); 
    else if(cdCurrentFilter === 'ly') { startDate = new Date(now.getFullYear() - 1, 0, 1); endDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59); } 
    else if(cdCurrentFilter === 'custom') { 
        if(document.getElementById('cd_startDate').value) startDate = new Date(document.getElementById('cd_startDate').value); 
        if(document.getElementById('cd_endDate').value) { endDate = new Date(document.getElementById('cd_endDate').value); endDate.setHours(23, 59, 59); } 
    }
    
    let combined = [];

    loadedData.invoices.forEach(i => {
        let d = new Date(i.Date);
        if(String(i['Client ID']) === String(currentClientDashboardId) && d >= startDate && d <= endDate) {
            combined.push({
                type: 'invoice', dateObj: d, dateStr: i.Date.substring(0, 10), ref: i['Invoice Number'], id: i['Invoice ID'],
                netAmount: parseFloat(i['Net Amount']) || 0, balance: i.balance || 0, dueDate: i['Due Date'] || i.dueDate
            });
        }
    });

    let mergedClientRecs = getMergedReceiptsList(loadedData.receipts.filter(r => {
       let d = new Date(r.Date);
       let isForClient = String(r['Client ID']) === String(currentClientDashboardId);
       return isForClient && d >= startDate && d <= endDate;
    }));

    mergedClientRecs.forEach(r => {
        let d = new Date(r.Date);
        combined.push({
            type: 'receipt', dateObj: d, dateStr: r.Date.substring(0, 10), ref: r['Receipt ID'], id: r['Receipt ID'],
            amount: r.Amount, mode: r['Payment Mode'], invRef: r.displayInvRef
        });
    });

    combined.sort((a, b) => b.dateObj - a.dateObj);

    document.getElementById('cd_ledgerList').innerHTML = combined.map(item => {
        if(item.type === 'invoice') {
            let isOverdue = false; let dueDateStr = item.dueDate; 
            if(!dueDateStr) { let d = new Date(item.dateObj); d.setDate(d.getDate() + 15); dueDateStr = d; }
            if(item.balance > 0 && new Date(dueDateStr) < new Date(now.setHours(0,0,0,0))) isOverdue = true;

            let status = item.balance <= 0 ? '<span class="badge-paid">Paid</span>' : (isOverdue ? '<span class="badge-due text-white bg-danger">Overdue</span>' : '<span class="badge-due">Due</span>');
            let balText = item.balance > 0 ? `<div class="small fw-bold text-danger">Bal: ${item.balance.toFixed(2)}</div>` : '';

            return `<tr onclick="openInvoicePreview('${item.id}')"><td class="d-none d-md-table-cell text-muted">${item.dateStr}</td><td class="d-none d-md-table-cell"><span class="badge bg-primary me-2">INV</span><span class="fw-bold text-dark">${item.ref}</span></td><td class="d-none d-md-table-cell text-muted small">Invoice generated</td><td class="d-none d-md-table-cell fw-bold text-dark">${item.netAmount.toFixed(2)}</td><td class="d-none d-md-table-cell">${status} <br> ${balText}</td><td class="d-none d-md-table-cell text-end text-nowrap">${item.balance > 0 ? `<button class="btn btn-sm btn-light text-success me-1" onclick="event.stopPropagation(); openAddReceipt('${item.id}')" title="Record Receipt"><i class="bi bi-cash-stack"></i></button><button class="btn btn-sm btn-light text-success me-1" onclick="event.stopPropagation(); sendWhatsAppReminder('${item.id}')" title="Send WhatsApp Reminder"><i class="bi bi-whatsapp"></i></button>` : ''}<button class="btn btn-sm btn-light" title="View"><i class="bi bi-eye"></i></button></td><td class="d-md-none p-0"><div class="p-3 pb-2"><div class="d-flex justify-content-between mb-1"><div class="fw-bold"><span class="badge bg-primary me-2" style="font-size:0.6rem;">INV</span>${item.ref}</div><span class="text-muted small">${item.dateStr}</span></div><div class="d-flex justify-content-between align-items-end mt-2"><div><div class="small fw-bold">Amt: ${item.netAmount.toFixed(2)}</div>${balText}</div><div>${status}</div></div></div>${item.balance > 0 ? `<div class="d-flex border-top"><button class="btn btn-light w-50 rounded-0 py-2 border-end text-success fw-bold" style="font-size:0.8rem;" onclick="event.stopPropagation(); openAddReceipt('${item.id}')"><i class="bi bi-cash-stack"></i> Receipt</button><button class="btn btn-light w-50 rounded-0 py-2 text-success fw-bold" style="font-size:0.8rem;" onclick="event.stopPropagation(); sendWhatsAppReminder('${item.id}')"><i class="bi bi-whatsapp"></i> Remind</button></div>` : ''}</td></tr>`;
        } else {
            return `<tr onclick="openReceiptPreview('${item.id}')"><td class="d-none d-md-table-cell text-muted">${item.dateStr}</td><td class="d-none d-md-table-cell"><span class="badge bg-success me-2">REC</span><span class="fw-bold text-dark">${item.ref}</span></td><td class="d-none d-md-table-cell text-muted small">For: ${item.invRef} <span class="badge bg-light text-dark border ms-1">${item.mode}</span></td><td class="d-none d-md-table-cell fw-bold text-success">+${item.amount.toFixed(2)}</td><td class="d-none d-md-table-cell"><span class="badge bg-light text-success border border-success">Received</span></td><td class="d-none d-md-table-cell text-end text-nowrap"><button class="btn btn-sm btn-light" title="View"><i class="bi bi-eye"></i></button></td><td class="d-md-none p-3"><div class="d-flex justify-content-between mb-1"><div class="fw-bold"><span class="badge bg-success me-2" style="font-size:0.6rem;">REC</span>${item.ref}</div><span class="text-muted small">${item.dateStr}</span></div><div class="text-muted small mb-2">For: ${item.invRef}</div><div class="d-flex justify-content-between align-items-end"><div class="fw-bold text-success">+${item.amount.toFixed(2)}</div><div><span class="badge bg-light text-dark border">${item.mode}</span></div></div></td></tr>`;
        }
    }).join('') || '<tr><td colspan="6" class="text-center text-muted py-4">No ledger records found for this period.</td></tr>';
}

function openStatement(clientId) { currentStmtClient = loadedData.clients.find(c => String(c.ID) === String(clientId)); if(!currentStmtClient) return; document.getElementById('previewStmtFilter').value = '3m'; document.getElementById('previewCustomDates').classList.add('d-none'); generateStatementPreview(); }
function handlePreviewFilterChange() { const val = document.getElementById('previewStmtFilter').value; if(val === 'custom') { document.getElementById('previewCustomDates').classList.remove('d-none'); } else { document.getElementById('previewCustomDates').classList.add('d-none'); } }
function applyStatementFilter() { const modal = bootstrap.Modal.getInstance(document.getElementById('filterModal')); if (modal) modal.hide(); generateStatementPreview(); }

function generateStatementPreview() {
  if(!currentStmtClient) return; const filter = document.getElementById('previewStmtFilter').value; const now = new Date(); let startDate = new Date(0); let endDate = new Date('2099-01-01');
  if(filter === '3m') startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); 
  else if(filter === '6m') startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); 
  else if(filter === 'ty') startDate = new Date(now.getFullYear(), 0, 1); 
  else if(filter === 'ly') { startDate = new Date(now.getFullYear() - 1, 0, 1); endDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59); } 
  else if(filter === 'custom') { if(document.getElementById('prevStartDate').value) startDate = new Date(document.getElementById('prevStartDate').value); if(document.getElementById('prevEndDate').value) { endDate = new Date(document.getElementById('prevEndDate').value); endDate.setHours(23, 59, 59); } }
  
  let stmtData = []; let openingBalance = 0;
  loadedData.invoices.forEach(i => { if(String(i['Client ID']) === String(currentStmtClient.ID)) { let d = new Date(i.Date); let amt = parseFloat(i['Net Amount']) || 0; if (d < startDate) { openingBalance += amt; } else if (d <= endDate) { stmtData.push({ date: d, type: 'Invoice', ref: i['Invoice Number'], amount: amt }); } } }); 
  
  // Use merged receipts for cleaner statements!
  let mergedClientRecs = getMergedReceiptsList(loadedData.receipts.filter(r => String(r['Client ID']) === String(currentStmtClient.ID)));
  mergedClientRecs.forEach(r => { let d = new Date(r.Date); let amt = -(parseFloat(r.Amount) || 0); if (d < startDate) { openingBalance += amt; } else if (d <= endDate) { stmtData.push({ date: d, type: 'Receipt', ref: r['Receipt ID'], amount: amt }); } }); 
  
  stmtData.sort((a, b) => a.date - b.date);
  
  let tbody = ''; let runTotal = openingBalance; 
  if (filter !== 'all') { tbody += `<tr class="table-light"><td class="text-muted fst-italic">Prior</td><td colspan="2" class="fw-bold text-muted">OPENING BALANCE</td><td class="text-end"></td><td class="text-end fw-bold ${openingBalance <= 0 ? 'text-success' : 'text-danger'}">${openingBalance.toFixed(2)}</td></tr>`; }
  stmtData.forEach(row => { runTotal += row.amount; tbody += `<tr><td>${row.date.toLocaleDateString()}</td><td><span class="badge ${row.type==='Invoice'?'bg-primary':'bg-success'}">${row.type}</span></td><td>${row.ref}</td><td class="text-end ${row.amount < 0 ? 'text-success' : 'text-danger'}">${Math.abs(row.amount).toFixed(2)}</td><td class="text-end fw-bold">${runTotal.toFixed(2)}</td></tr>`; }); 
  if(stmtData.length === 0 && openingBalance === 0) tbody = '<tr><td colspan="5" class="text-center text-muted py-4">No records found for this period.</td></tr>';
  
  let logoSrc = loadedData.company['Logo URL'] || ''; let logoHtml = logoSrc ? `<img src="${logoSrc}" class="d-block mb-2" style="max-height: 55px; width: auto; object-fit: contain;">` : '';
  let html = `<div class="row mb-4 pb-3 border-bottom"><div class="col-7">${logoHtml}<h5 class="fw-bold mb-1 text-dark">${loadedData.company['Company Name'] || ''}</h5><p class="text-muted mb-0" style="white-space: pre-line; line-height: 1.4;">${loadedData.company['Address'] || ''}\n${loadedData.company['Contact'] || ''}</p></div><div class="col-5 text-end"><h2 class="fw-bold" style="color: #4f46e5; letter-spacing: -0.5px;">STATEMENT</h2><p class="mb-1"><span class="text-muted fw-bold me-1">Client:</span> <span class="fw-bold">${currentStmtClient.Name}</span></p><p class="mb-0"><span class="text-muted fw-bold me-1">Date:</span> <span>${new Date().toLocaleDateString()}</span></p></div></div><table class="table table-bordered table-sm mt-4"><thead class="table-light"><tr><th>Date</th><th>Type</th><th>Ref #</th><th class="text-end">Amount</th><th class="text-end">Balance</th></tr></thead><tbody>${tbody}</tbody></table><h4 class="text-end fw-bold mt-4 border-top pt-3">Final Balance Due: <span class="${runTotal <= 0 ? 'text-success' : 'text-danger'}">${runTotal.toFixed(2)}</span></h4>`;
  setupPreviewPage('Statement Preview', html, { type: 'Statement', id: currentStmtClient.Name.substring(0,6), clientName: currentStmtClient.Name }, null, null );
}

function showActionModal(type, id) {
  const body = document.getElementById('actionModalBody'); let html = '';
  if (type === 'service') {
    html += `<button class="btn btn-light border w-100 text-start py-2 mb-2" onclick="closeActionModal(); openEditService('${id}')"><i class="bi bi-pencil me-3 text-secondary"></i> Edit Service</button>`;
    html += `<button class="btn btn-light border w-100 text-start py-2 text-danger" onclick="closeActionModal(); confirmDelete('service', '${id}')"><i class="bi bi-trash me-3"></i> Delete Service</button>`;
  }
  body.innerHTML = html; new bootstrap.Modal(document.getElementById('actionModal')).show();
}
function closeActionModal() { const modal = bootstrap.Modal.getInstance(document.getElementById('actionModal')); if(modal) modal.hide(); }

function renderTables() {
  renderDashboard(); 

  const searchInv = document.getElementById('searchInvoices')?.value.toLowerCase() || '';
  const filteredInvoices = loadedData.invoices.filter(i => i['Invoice Number'].toLowerCase().includes(searchInv) || i['Client Name'].toLowerCase().includes(searchInv));
  
  document.getElementById('invoiceTableBody').innerHTML = filteredInvoices.map(i => {
    let isOverdue = false; let dueDateStr = i['Due Date'] || i.dueDate; 
    if(!dueDateStr) { let d = new Date(i.Date); d.setDate(d.getDate() + 15); dueDateStr = d; }
    if(i.balance > 0 && new Date(dueDateStr) < new Date(new Date().setHours(0,0,0,0))) isOverdue = true;

    let status = i.balance <= 0 ? '<span class="badge-paid">Paid</span>' : (isOverdue ? '<span class="badge-due text-white bg-danger">Overdue</span>' : '<span class="badge-due">Due</span>');
    let netAmt = (parseFloat(i['Net Amount']) || 0).toFixed(2); let balText = i.balance > 0 ? `<div class="small fw-bold text-danger">Bal: ${i.balance.toFixed(2)}</div>` : '';
    
    return `<tr onclick="openInvoicePreview('${i['Invoice ID']}')"><td class="d-none d-md-table-cell fw-bold text-primary">${i['Invoice Number']}</td><td class="d-none d-md-table-cell text-muted">${i.Date.substring(0, 10)}</td><td class="d-none d-md-table-cell fw-medium">${i['Client Name']}</td><td class="d-none d-md-table-cell text-muted">${netAmt}</td><td class="d-none d-md-table-cell fw-bold">${i.balance > 0 ? i.balance.toFixed(2) : '0.00'}</td><td class="d-none d-md-table-cell">${status}</td><td class="d-none d-md-table-cell text-end text-nowrap">${i.balance > 0 ? `<button class="btn btn-sm btn-light text-success me-1 mb-1" onclick="event.stopPropagation(); openAddReceipt('${i['Invoice ID']}')" title="Record Receipt"><i class="bi bi-cash-stack"></i></button><button class="btn btn-sm btn-light text-success me-1 mb-1" onclick="event.stopPropagation(); sendWhatsAppReminder('${i['Invoice ID']}')" title="Send WhatsApp Reminder"><i class="bi bi-whatsapp"></i></button>` : ''}<button class="btn btn-sm btn-light me-1 mb-1" title="View"><i class="bi bi-eye"></i> View</button></td><td class="d-md-none p-0"><div class="p-3 pb-2"><div class="d-flex justify-content-between mb-1"><span class="fw-bold text-primary">${i['Invoice Number']}</span><span class="text-muted small">${i.Date.substring(0, 10)}</span></div><div class="text-wrap fw-medium small mb-2">${i['Client Name']}</div><div class="d-flex justify-content-between align-items-end"><div><div class="small fw-bold">Amt: ${netAmt}</div>${balText}</div><div>${status}</div></div></div>${i.balance > 0 ? `<div class="d-flex border-top"><button class="btn btn-light w-50 rounded-0 py-2 border-end text-success fw-bold" style="font-size:0.8rem;" onclick="event.stopPropagation(); openAddReceipt('${i['Invoice ID']}')"><i class="bi bi-cash-stack"></i> Receipt</button><button class="btn btn-light w-50 rounded-0 py-2 text-success fw-bold" style="font-size:0.8rem;" onclick="event.stopPropagation(); sendWhatsAppReminder('${i['Invoice ID']}')"><i class="bi bi-whatsapp"></i> Remind</button></div>` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="7" class="text-center text-muted py-4">No invoices found.</td></tr>';

  const searchCl = document.getElementById('searchClients')?.value.toLowerCase() || '';
  const filteredClients = loadedData.clients.filter(c => c.Name.toLowerCase().includes(searchCl) || (c.Mobile && String(c.Mobile).includes(searchCl)));
  document.getElementById('clientTableBody').innerHTML = filteredClients.map(c => {
    let balText = c.balanceDue > 0 ? `<span class="text-danger fw-bold">${c.balanceDue.toFixed(2)}</span>` : `<span class="text-success fw-bold">0.00</span>`;
    let contactHTML = ''; if(c['Contact Name'] || c.Mobile) { let n = c['Contact Name'] ? `<i class="bi bi-person"></i> ${c['Contact Name']}` : ''; let m = c.Mobile ? `<i class="bi bi-telephone"></i> ${String(c.Mobile).replace(/^'/, '')}` : ''; let sep = (c['Contact Name'] && c.Mobile) ? ' | ' : ''; contactHTML = `<div class="text-muted small mb-1">${n}${sep}${m}</div>`; }
    return `<tr onclick="openClientDashboard('${c.ID}')"><td class="d-none d-md-table-cell fw-medium">${c.Name}</td><td class="d-none d-md-table-cell text-muted">${c['Contact Name'] || '-'}</td><td class="d-none d-md-table-cell text-muted">${(c.Mobile ? String(c.Mobile).replace(/^'/, '') : '-')}</td><td class="d-none d-md-table-cell fw-bold ${c.balanceDue > 0 ? 'text-danger' : 'text-success'}">${(c.balanceDue||0).toFixed(2)}</td><td class="d-none d-md-table-cell text-end text-nowrap"><button class="btn btn-sm btn-light text-success me-1 mb-1" onclick="event.stopPropagation(); openAddReceipt(null, '${c.ID}')" title="Record Receipt"><i class="bi bi-cash-stack"></i></button><button class="btn btn-sm btn-info text-white me-1 mb-1" onclick="event.stopPropagation(); openStatement('${c.ID}')" title="Statement"><i class="bi bi-journal-text"></i></button><button class="btn btn-sm btn-light mb-1" onclick="event.stopPropagation(); openEditClient('${c.ID}')" title="Edit"><i class="bi bi-pencil"></i></button></td><td class="d-md-none p-3"><div class="text-wrap fw-bold mb-1" style="font-size: 0.95rem;">${c.Name}</div>${contactHTML}<div class="small fw-bold mt-1">Balance: ${balText}</div></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="text-center text-muted py-4">No clients found.</td></tr>';

  const searchSr = document.getElementById('searchServices')?.value.toLowerCase() || '';
  const filteredServices = loadedData.services.filter(s => s.Name.toLowerCase().includes(searchSr));
  document.getElementById('serviceTableBody').innerHTML = filteredServices.map(s => 
    `<tr onclick="if(window.innerWidth < 768) showActionModal('service', '${s.ID}')"><td class="d-none d-md-table-cell fw-medium">${s.Name}</td><td class="d-none d-md-table-cell text-muted">${s.Description || '-'}</td><td class="d-none d-md-table-cell fw-medium">${(parseFloat(s.Rate)||0).toFixed(2)}</td><td class="d-none d-md-table-cell text-end text-nowrap"><button class="btn btn-sm btn-light me-1" onclick="event.stopPropagation(); openEditService('${s.ID}')"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-light text-danger" onclick="event.stopPropagation(); confirmDelete('service', '${s.ID}')"><i class="bi bi-trash"></i></button></td><td class="d-md-none p-3 d-flex justify-content-between align-items-center"><div><div class="fw-bold mb-1">${s.Name}</div><div class="small text-muted">Rate: ${parseFloat(s.Rate).toFixed(2)}</div></div></td></tr>`
  ).join('') || '<tr><td colspan="4" class="text-center text-muted py-4">No services found.</td></tr>';

  // Render unified receipts
  const searchRc = document.getElementById('searchReceipts')?.value.toLowerCase() || '';
  let mergedAll = getMergedReceiptsList(loadedData.receipts);
  const filteredReceipts = mergedAll.filter(r => String(r['Receipt ID']).toLowerCase().includes(searchRc));
  
  document.getElementById('receiptTableBody').innerHTML = filteredReceipts.map(r => {
    let cl = loadedData.clients.find(c => String(c.ID) === String(r['Client ID']));
    let clientName = cl ? cl.Name : '-'; 
    return `<tr onclick="openReceiptPreview('${r['Receipt ID']}')"><td class="d-none d-md-table-cell fw-bold text-secondary">${r['Receipt ID'] || '-'}</td><td class="d-none d-md-table-cell text-muted">${r.Date.substring(0, 10)}</td><td class="d-none d-md-table-cell fw-medium">${clientName} <br><small class="text-muted">${r.displayInvRef}</small></td><td class="d-none d-md-table-cell"><span class="badge bg-light text-dark border">${r['Payment Mode']}</span></td><td class="d-none d-md-table-cell fw-bold text-success text-end">+${(parseFloat(r.Amount)||0).toFixed(2)}</td><td class="d-none d-md-table-cell text-end text-nowrap"><button class="btn btn-sm btn-light me-1 mb-1" title="View"><i class="bi bi-eye"></i> View</button></td><td class="d-md-none p-3"><div class="d-flex justify-content-between mb-1"><span class="fw-bold text-secondary">${r['Receipt ID'] || '-'}</span><span class="text-muted small">${r.Date.substring(0, 10)}</span></div><div class="text-wrap fw-medium small mb-2">${clientName} <span class="text-muted ms-1">(${r.displayInvRef})</span></div><div class="d-flex justify-content-between align-items-end"><div class="fw-bold text-success">+${(parseFloat(r.Amount)||0).toFixed(2)}</div><div><span class="badge bg-light text-dark border">${r['Payment Mode']}</span></div></div></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="text-center text-muted py-4">No receipts found.</td></tr>';

  renderClientDashboard();
}

function openAddClient() { ['c_id','c_name','c_contact','c_email','c_mobile'].forEach(id => document.getElementById(id).value = ''); document.getElementById('clientModalTitle').innerText = 'Add Client'; showView('clientFormView'); }
function openEditClient(id) { const c = loadedData.clients.find(x => String(x.ID) === String(id)); document.getElementById('c_id').value = c.ID; document.getElementById('c_name').value = c.Name; document.getElementById('c_contact').value = c['Contact Name']; document.getElementById('c_email').value = c.Email; document.getElementById('c_mobile').value = c.Mobile ? String(c.Mobile).replace(/^'/, '') : ''; document.getElementById('clientModalTitle').innerText = 'Edit Client'; showView('clientFormView'); }
function saveClient() { const id = document.getElementById('c_id').value || generateUID('CLI'); let mobileVal = document.getElementById('c_mobile').value; mobileVal = mobileVal ? mobileVal.replace(/^'/, '') : ''; const data = [id, document.getElementById('c_name').value, document.getElementById('c_contact').value, document.getElementById('c_email').value, mobileVal]; if(!data[1]) return customAlert("Client name required!"); document.getElementById('c_id').value ? executeSave('updateClient', ...data) : executeSave('addClient', ...data); showView(lastMainView); }

function openAddService() { ['s_id','s_name','s_desc','s_rate'].forEach(id => document.getElementById(id).value = ''); document.getElementById('serviceModalTitle').innerText = 'Add Service'; showView('serviceFormView'); }
function openEditService(id) { const s = loadedData.services.find(x => String(x.ID) === String(id)); document.getElementById('s_id').value = s.ID; document.getElementById('s_name').value = s.Name; document.getElementById('s_desc').value = s.Description; document.getElementById('s_rate').value = s.Rate; document.getElementById('serviceModalTitle').innerText = 'Edit Service'; showView('serviceFormView'); }
function saveService() { const id = document.getElementById('s_id').value || generateUID('SRV'); const data = [id, document.getElementById('s_name').value, document.getElementById('s_desc').value, document.getElementById('s_rate').value]; if(!data[1] || !data[3]) return customAlert("Name and Rate required!"); document.getElementById('s_id').value ? executeSave('updateService', ...data) : executeSave('addService', ...data); showView(lastMainView); }

function openAddInvoice() { invoiceItems = []; renderItems(); document.getElementById('inv_id').value = ''; document.getElementById('inv_client').value = ''; document.getElementById('inv_disc').value = '0'; document.getElementById('inv_round').value = '0'; document.getElementById('inv_num').value = loadedData.nextInvoiceNumber || 'INV-TEMP'; document.getElementById('inv_date').valueAsDate = new Date(); autoSetDueDate(); showView('invoiceFormView'); }
function openEditInvoice(invId) { const inv = loadedData.invoices.find(i => String(i['Invoice ID']) === String(invId)); if(!inv) return; document.getElementById('inv_id').value = invId; document.getElementById('inv_client').value = inv['Client Name']; document.getElementById('inv_date').value = inv.Date.substring(0, 10); document.getElementById('inv_due_date').value = inv['Due Date'] ? inv['Due Date'].substring(0, 10) : ''; document.getElementById('inv_num').value = inv['Invoice Number']; document.getElementById('inv_disc').value = inv['Discount']; document.getElementById('inv_round').value = inv['Round Off']; invoiceItems = (loadedData.invoiceItems || []).filter(i => String(i['Invoice ID']) === String(invId)).map(i => ({ serviceId: i['Service ID'], name: i.Name, description: i.Description, rate: parseFloat(i.Rate)||0, quantity: parseFloat(i.Quantity)||0, amount: parseFloat(i.Amount)||0 })); renderItems(); showView('invoiceFormView'); }
function autoSetDueDate() { let d = document.getElementById('inv_date').valueAsDate; if(d) { d.setDate(d.getDate() + 15); document.getElementById('inv_due_date').valueAsDate = d; } }
function autoFillServiceDetails() { const s = loadedData.services.find(x => x.Name === document.getElementById('item_service').value.trim()); if(s) { document.getElementById('item_rate').value = s.Rate; document.getElementById('item_desc').value = s.Description; } }
function addItem() { const s = loadedData.services.find(x => x.Name === document.getElementById('item_service').value.trim()); if(!s) return customAlert("Select a valid service!"); const q = parseFloat(document.getElementById('item_qty').value); const r = parseFloat(document.getElementById('item_rate').value); if(!q || !r) return; invoiceItems.push({ serviceId: s.ID, name: s.Name, description: document.getElementById('item_desc').value, rate: r, quantity: q, amount: q * r }); ['item_service','item_desc','item_rate'].forEach(id => document.getElementById(id).value = ''); document.getElementById('item_qty').value = '1'; renderItems(); }
function removeItem(index) { invoiceItems.splice(index, 1); renderItems(); }
function renderItems() { let tbody = document.getElementById('itemList'); tbody.innerHTML = ''; let total = 0; invoiceItems.forEach((i, idx) => { tbody.innerHTML += `<tr><td class="text-wrap" style="max-width: 200px;"><div class="fw-bold" style="font-size:0.85rem;">${i.name}</div><div class="text-muted" style="font-size:0.75rem;">${i.description}</div></td><td class="align-middle">${i.rate}</td><td class="align-middle">${i.quantity}</td><td class="text-end fw-medium align-middle">${i.amount.toFixed(2)}</td><td class="text-end align-middle"><button class="btn btn-sm text-danger border-0 bg-transparent" onclick="removeItem(${idx})"><i class="bi bi-trash"></i></button></td></tr>`; total += i.amount; }); document.getElementById('inv_total').value = total.toFixed(2); calculateNet(); }
function calculateNet() { let t = parseFloat(document.getElementById('inv_total').value) || 0; let d = parseFloat(document.getElementById('inv_disc').value) || 0; let r = parseFloat(document.getElementById('inv_round').value) || 0; document.getElementById('inv_net').value = (t - d + r).toFixed(2); }

function saveInvoice() { 
    const invId = document.getElementById('inv_id').value; 
    const client = loadedData.clients.find(c => c.Name === document.getElementById('inv_client').value.trim()); 
    if(!client) return customAlert("Select a valid client!"); 
    if(invoiceItems.length === 0) return customAlert("Add at least one item!"); 
    
    const targetInvId = invId || generateUID('INV');
    const invData = { id: targetInvId, clientId: client.ID, clientName: client.Name, date: document.getElementById('inv_date').value, dueDate: document.getElementById('inv_due_date').value, invNum: document.getElementById('inv_num').value, totalAmount: document.getElementById('inv_total').value, discount: document.getElementById('inv_disc').value, roundOff: document.getElementById('inv_round').value, netAmount: document.getElementById('inv_net').value }; 
    const initialPaymentAmt = parseFloat(document.getElementById('inv_rec_amount').value) || 0;
    const initialPaymentMode = document.getElementById('inv_rec_mode').value;
    
    if(invId) {
        executeSave('updateInvoice', targetInvId, invData, invoiceItems); 
        if (initialPaymentAmt > 0) {
            executeSave('addReceiptBatch', [{recId: generateReceiptNum(), invId: targetInvId, date: invData.date, amount: initialPaymentAmt, mode: initialPaymentMode, clientId: client.ID}]);
        }
    } else {
        let receiptData = null;
        if (initialPaymentAmt > 0) { receiptData = { date: invData.date, amount: initialPaymentAmt, mode: initialPaymentMode, recNum: generateReceiptNum(), clientId: client.ID }; }
        executeSave('addInvoice', invData, invoiceItems, receiptData); 
    }
    
    document.getElementById('inv_rec_amount').value = ''; showView(lastMainView); 
}

function generateReceiptNum() { if(!loadedData.receipts || loadedData.receipts.length === 0) return "REC-0001"; let max = 0; loadedData.receipts.forEach(r => { let match = String(r['Receipt ID']).match(/(\d+)$/); if(match && parseInt(match[1]) > max) max = parseInt(match[1]); }); return "REC-" + (max + 1).toString().padStart(4, '0'); }
function filterInvoicesForReceipt() { let clientName = document.getElementById('rec_client_input').value.trim(); let clientObj = loadedData.clients.find(c => c.Name === clientName); let sel = document.getElementById('rec_invoice'); sel.innerHTML = '<option value="">None (Advance Payment)</option>'; document.getElementById('rec_client_id').value = clientObj ? clientObj.ID : ''; if(!clientObj) return; loadedData.invoices.filter(i => String(i['Client ID']) === String(clientObj.ID) && i.balance > 0).forEach(inv => { sel.innerHTML += `<option value="${inv['Invoice ID']}">${inv['Invoice Number']} (Bal: ${inv.balance.toFixed(2)})</option>`; }); }
function openAddReceipt(forceInvId = null, forceClientId = null) { document.getElementById('r_id').value = ''; document.getElementById('rec_num').value = generateReceiptNum(); document.getElementById('rec_client_input').value = ''; if(forceInvId) { let inv = loadedData.invoices.find(i => String(i['Invoice ID']) === String(forceInvId)); document.getElementById('rec_client_input').value = inv['Client Name']; filterInvoicesForReceipt(); document.getElementById('rec_invoice').value = forceInvId; document.getElementById('rec_client_input').disabled = true; document.getElementById('rec_client_clear').disabled = true; document.getElementById('rec_invoice').disabled = true; } else if (forceClientId) { let cl = loadedData.clients.find(c => String(c.ID) === String(forceClientId)); document.getElementById('rec_client_input').value = cl.Name; filterInvoicesForReceipt(); document.getElementById('rec_invoice').value = ''; document.getElementById('rec_client_input').disabled = true; document.getElementById('rec_client_clear').disabled = true; document.getElementById('rec_invoice').disabled = false; } else { document.getElementById('rec_client_input').disabled = false; document.getElementById('rec_client_clear').disabled = false; document.getElementById('rec_invoice').disabled = false; filterInvoicesForReceipt(); } document.getElementById('rec_date').valueAsDate = new Date(); document.getElementById('rec_amount').value = ''; document.getElementById('receiptModalTitle').innerText = 'Record Receipt'; showView('receiptFormView'); }

function openEditReceipt(recId) { 
    let matchingRecs = loadedData.receipts.filter(r => String(r['Receipt ID']) === String(recId));
    if(matchingRecs.length === 0) return;
    let totalAmt = matchingRecs.reduce((sum, r) => sum + (parseFloat(r.Amount)||0), 0);
    let firstRec = matchingRecs[0];
    
    document.getElementById('r_id').value = firstRec['Receipt ID']; 
    document.getElementById('rec_num').value = firstRec['Receipt ID']; 
    const client = loadedData.clients.find(c => String(c.ID) === String(firstRec['Client ID'])); 
    
    document.getElementById('rec_client_input').value = client ? client.Name : ''; 
    filterInvoicesForReceipt(); 
    
    // Select the first linked invoice for the edit form context
    document.getElementById('rec_invoice').value = firstRec['Invoice ID'] || ''; 
    document.getElementById('rec_client_input').disabled = true; 
    document.getElementById('rec_client_clear').disabled = true; 
    document.getElementById('rec_invoice').disabled = true; 
    document.getElementById('rec_date').value = firstRec.Date.substring(0, 10); 
    document.getElementById('rec_amount').value = totalAmt; 
    document.getElementById('rec_mode').value = firstRec['Payment Mode']; 
    document.getElementById('receiptModalTitle').innerText = 'Edit Receipt'; 
    showView('receiptFormView'); 
}

// FIXED: TRUE ARRAY WATERFALL ENGINE
function saveReceipt() { 
    const rid = document.getElementById('r_id').value; 
    const rNum = document.getElementById('rec_num').value; 
    const clientId = document.getElementById('rec_client_id').value; 
    const startingInvId = document.getElementById('rec_invoice').value; 
    let amountLeft = parseFloat(document.getElementById('rec_amount').value) || 0; 
    const rDate = document.getElementById('rec_date').value;
    const rMode = document.getElementById('rec_mode').value;
    
    if(!clientId || amountLeft <= 0 || !rNum) return customAlert("Client, Amount, and Receipt Number required!"); 
    
    let splitReceipts = [];
    
    // We read balances directly from loadedData since optimisticUpdate hasn't run yet
    let tempBalances = {};
    loadedData.invoices.forEach(inv => tempBalances[inv['Invoice ID']] = inv.balance);

    // 1. Fully or partially pay the explicit invoice
    if (startingInvId) {
        const targetInvBal = tempBalances[startingInvId] || 0;
        if (targetInvBal > 0) {
            let payAmt = Math.min(amountLeft, targetInvBal);
            splitReceipts.push({ recId: rNum, invId: startingInvId, date: rDate, amount: payAmt, mode: rMode, clientId: clientId });
            amountLeft -= payAmt;
            amountLeft = parseFloat(amountLeft.toFixed(2));
            tempBalances[startingInvId] -= payAmt;
        }
    }

    // 2. Waterfall anything remaining to oldest unpaid invoices
    if (amountLeft > 0) {
        let unpaidInvs = loadedData.invoices
            .filter(i => String(i['Client ID']) === String(clientId) && tempBalances[i['Invoice ID']] > 0 && String(i['Invoice ID']) !== String(startingInvId))
            .sort((a, b) => new Date(a.Date) - new Date(b.Date));
        
        for (let nextInv of unpaidInvs) {
            if (amountLeft <= 0) break;
            let targetBal = tempBalances[nextInv['Invoice ID']];
            let payAmt = Math.min(amountLeft, targetBal);
            splitReceipts.push({ recId: rNum, invId: nextInv['Invoice ID'], date: rDate, amount: payAmt, mode: rMode, clientId: clientId });
            amountLeft -= payAmt;
            amountLeft = parseFloat(amountLeft.toFixed(2));
            tempBalances[nextInv['Invoice ID']] -= payAmt;
        }
    }

    // 3. Log any excess cash as an unlinked advance
    if (amountLeft > 0) {
        splitReceipts.push({ recId: rNum, invId: '', date: rDate, amount: amountLeft, mode: rMode, clientId: clientId });
    }

    if(rid) { 
        executeSave('updateReceiptBatch', rid, splitReceipts); 
    } else {
        executeSave('addReceiptBatch', splitReceipts); 
    }
    
    showView(lastMainView); 
}
