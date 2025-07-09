// Initialize IndexedDB
let db;
const DB_NAME = 'ExpenseTrackerDB';
const DB_VERSION = 1;
let expenses = [];
let walletBalance = 0;
const DAILY_ADDITION = 50;
let currentServerTime;

const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = event => {
        console.error('Database error:', event.target.error);
        reject(event.target.error);
    };

    request.onsuccess = event => {
        db = event.target.result;
        resolve(db);
    };

    request.onupgradeneeded = event => {
        const db = event.target.result;
        
        // Create expenses store
        if (!db.objectStoreNames.contains('expenses')) {
            const expenseStore = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
            expenseStore.createIndex('date', 'date');
        }
        
        // Create wallet store
        if (!db.objectStoreNames.contains('wallet')) {
            db.createObjectStore('wallet', { keyPath: 'id' });
        }

        // Create archives store
        if (!db.objectStoreNames.contains('archives')) {
            const archiveStore = db.createObjectStore('archives', { keyPath: 'monthKey' });
            archiveStore.createIndex('date', 'date');
        }
    };
});

// Load data from IndexedDB
async function loadData() {
    try {
        await dbPromise;
        
        // Load wallet balance first
        const walletStore = db.transaction('wallet', 'readonly').objectStore('wallet');
        const walletData = await new Promise((resolve, reject) => {
            const request = walletStore.get(1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        if (walletData) {
            walletBalance = walletData.balance;
            await checkDailyAddition();
        } else {
            await calculateInitialBalance();
        }

        // Load and sort expenses
        const expenseStore = db.transaction('expenses', 'readonly').objectStore('expenses');
        const loadedExpenses = await new Promise((resolve, reject) => {
            const request = expenseStore.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        // Sort by timestamp (newest first)
        expenses = loadedExpenses.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB - dateA;
        });

        updateWalletDisplay();
        updateTable();
        updateCurrentMonth();
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

async function getCurrentTime() {
    try {
        const response = await fetch('https://timeapi.io/api/Time/current/zone?timeZone=Asia/Riyadh', {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        currentServerTime = new Date(data.dateTime);
        updateTimeDisplay(currentServerTime);
        return currentServerTime;
    } catch (error) {
        console.error('Error fetching time:', error);
        const localTime = new Date();
        updateTimeDisplay(localTime, true);
        return localTime;
    }
}

function updateTimeDisplay(time, isLocal = false) {
    const dateTimeElement = document.getElementById('currentDateTime');
    const timeString = time.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' });
    dateTimeElement.textContent = `Current Date & Time (Saudi Arabia): ${timeString}`;
    if (isLocal) {
        dateTimeElement.textContent += ' (Using local time - offline mode)';
    }
}

async function checkDailyAddition() {
    const currentDate = await getCurrentTime();
    
    // Get the latest expense entry to find the last activity date
    let lastActivityDate;
    if (expenses.length > 0) {
        lastActivityDate = new Date(expenses[0].date); // expenses are already sorted newest first
    } else {
        // If no expenses, check wallet data
        const walletStore = db.transaction('wallet', 'readonly').objectStore('wallet');
        const walletData = await new Promise((resolve, reject) => {
            const request = walletStore.get(1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        
        if (walletData) {
            lastActivityDate = new Date(walletData.lastUpdated);
        } else {
            // If no wallet data either, initialize with current date
            lastActivityDate = currentDate;
            await calculateInitialBalance();
            return;
        }
    }

    // Reset hours, minutes, seconds to compare only dates
    lastActivityDate.setHours(0, 0, 0, 0);
    const compareDate = new Date(currentDate);
    compareDate.setHours(0, 0, 0, 0);

    // Calculate days difference
    const daysSinceLastActivity = Math.floor((compareDate - lastActivityDate) / (1000 * 60 * 60 * 24));
    
    if (daysSinceLastActivity >= 1) {
        // Add daily amount for each missed day
        const additionAmount = DAILY_ADDITION * daysSinceLastActivity;
        walletBalance += additionAmount;
        
        // Create a system entry to record the daily addition
        const systemEntry = {
            id: Date.now(),
            date: currentDate.toISOString(),
            amount: -additionAmount, // Negative amount to show as addition
            walletBalance: walletBalance,
            isSystemEntry: true // Flag to identify system-generated entries
        };
        
        // Add to beginning of expenses array
        expenses.unshift(systemEntry);
        
        // Update database
        const tx = db.transaction(['expenses', 'wallet'], 'readwrite');
        const expenseStore = tx.objectStore('expenses');
        const walletStore = tx.objectStore('wallet');
        
        try {
            await expenseStore.add(systemEntry);
            await walletStore.put({
                id: 1,
                balance: walletBalance,
                lastUpdated: currentDate.toISOString()
            });
            
            // Update displays
            updateWalletDisplay();
            updateTable();
        } catch (error) {
            console.error('Error updating daily addition:', error);
            expenses.shift(); // Remove from array if save failed
            walletBalance -= additionAmount; // Restore wallet balance
        }
    }
}

async function calculateInitialBalance() {
    const currentDate = await getCurrentTime();
    const dayOfMonth = currentDate.getDate();
    
    if (dayOfMonth >= 3) {
        const daysToCount = dayOfMonth - 2; // Count days since day 3
        walletBalance = DAILY_ADDITION * daysToCount;
    } else {
        walletBalance = 0;
    }

    // Save to IndexedDB
    const walletStore = db.transaction('wallet', 'readwrite').objectStore('wallet');
    await new Promise((resolve, reject) => {
        const request = walletStore.put({
            id: 1,
            balance: walletBalance,
            lastUpdated: new Date().toISOString()
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });

    updateWalletDisplay();
    return walletBalance;
}

function updateTable() {
    const tableBody = document.getElementById('expenseTable');
    tableBody.innerHTML = '';
    
    expenses.forEach((expense, index) => {
        const row = document.createElement('tr');
        if (index === 0) row.classList.add('new-entry');
        const date = new Date(expense.date);
        
        // Handle system entries differently
        if (expense.isSystemEntry) {
            row.innerHTML = `
                <td>${date.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })}</td>
                <td class="positive">+${(-expense.amount).toFixed(2)} (Daily)</td>
                <td class="${expense.walletBalance >= 0 ? 'positive' : 'negative'}">
                    ${expense.walletBalance.toFixed(2)}
                </td>
                <td>
                    <button disabled class="delete-button" style="background-color: #2e7d32;">
                        <span class="material-icons">update</span>
                    </button>
                </td>
            `;
        } else {
            row.innerHTML = `
                <td>${date.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })}</td>
                <td>${expense.amount.toFixed(2)}</td>
                <td class="${expense.walletBalance >= 0 ? 'positive' : 'negative'}">
                    ${expense.walletBalance.toFixed(2)}
                </td>
                <td>
                    <button onclick="deleteExpense(${expense.id}, ${expense.amount})" 
                            class="delete-button">
                        <span class="material-icons">delete</span>
                    </button>
                </td>
            `;
        }
        tableBody.appendChild(row);
    });
}

// Add expense function
async function addExpense() {
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    const currentTime = await getCurrentTime();
    
    // Deduct from wallet balance
    walletBalance -= amount;
    
    // Create new expense object
    const expense = {
        id: Date.now(),
        date: currentTime.toISOString(), // Store as ISO string for consistent sorting
        amount: amount,
        walletBalance: walletBalance
    };
    
    // Add to beginning of expenses array
    expenses.unshift(expense);
    
    // Save to IndexedDB
    const tx = db.transaction(['expenses', 'wallet'], 'readwrite');
    const expenseStore = tx.objectStore('expenses');
    const walletStore = tx.objectStore('wallet');
    
    try {
        await expenseStore.add(expense);
        await walletStore.put({
            id: 1,
            balance: walletBalance,
            lastUpdated: new Date().toISOString()
        });
        
        // Clear input
        document.getElementById('expenseAmount').value = '';
        
        // Update displays
        updateWalletDisplay();
        updateTable();

        // Scroll to top to show new entry
        window.scrollTo(0, 0);
    } catch (error) {
        console.error('Error adding expense:', error);
        expenses.shift(); // Remove from array if save failed
        walletBalance += amount; // Restore wallet balance
        alert('Error saving expense. Please try again.');
    }
}

// Delete expense function
async function deleteExpense(id, amount) {
    // Add the amount back to wallet balance
    walletBalance += amount;
    
    // Remove from expenses array
    expenses = expenses.filter(expense => expense.id !== id);
    
    // Update IndexedDB
    const tx = db.transaction(['expenses', 'wallet'], 'readwrite');
    const expenseStore = tx.objectStore('expenses');
    const walletStore = tx.objectStore('wallet');
    
    try {
        // Delete from IndexedDB
        await expenseStore.delete(id);
        await walletStore.put({
            id: 1,
            balance: walletBalance,
            lastUpdated: new Date().toISOString()
        });
        
        // Update displays
        updateWalletDisplay();
        updateTable();
    } catch (error) {
        console.error('Error deleting expense:', error);
        // Restore state if delete failed
        expenses.push(expense);
        walletBalance -= amount;
        alert('Error deleting expense. Please try again.');
    }
}

function updateWalletDisplay() {
    const walletBalanceElement = document.getElementById('walletBalance');
    walletBalanceElement.textContent = walletBalance.toFixed(2);
    
    // Remove existing classes
    walletBalanceElement.classList.remove('positive', 'negative');
    // Add appropriate class based on balance
    if (walletBalance >= 0) {
        walletBalanceElement.classList.add('positive');
    } else {
        walletBalanceElement.classList.add('negative');
    }
}

// Export data to JSON file
function exportData() {
    const data = {
        expenses: expenses,
        walletBalance: walletBalance,
        lastUpdate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'expense-tracker-backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Import data from JSON file
async function importData(event) {
    try {
        const file = event.target.files[0];
        if (!file) return;

        const text = await file.text();
        const data = JSON.parse(text);

        // Validate data structure
        if (!Array.isArray(data.expenses) || typeof data.walletBalance !== 'number') {
            throw new Error('Invalid backup file format');
        }

        // Clear existing data
        const expenseStore = db.transaction('expenses', 'readwrite').objectStore('expenses');
        await new Promise((resolve, reject) => {
            const request = expenseStore.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });

        // Import new expenses
        for (const expense of data.expenses) {
            await new Promise((resolve, reject) => {
                const request = expenseStore.add(expense);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        // Update wallet balance
        const walletStore = db.transaction('wallet', 'readwrite').objectStore('wallet');
        await new Promise((resolve, reject) => {
            const request = walletStore.put({
                id: 1,
                balance: data.walletBalance,
                lastUpdated: new Date().toISOString()
            });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });

        expenses = data.expenses;
        walletBalance = data.walletBalance;
        updateTable();
        updateWalletDisplay();
        alert('Data imported successfully!');
    } catch (error) {
        console.error('Error importing data:', error);
        alert('Error importing data. Please check the file format.');
    }
    event.target.value = ''; // Reset file input
}

async function checkAndArchive() {
    const currentDate = await getCurrentTime();
    const dayOfMonth = currentDate.getDate();
    
    if (dayOfMonth === 3) {
        // Get previous month's data
        const prevMonth = new Date(currentDate);
        prevMonth.setMonth(prevMonth.getMonth() - 1);
        const monthKey = `${(prevMonth.getMonth() + 1).toString().padStart(2, '0')}-${prevMonth.getFullYear()}`;
        
        // Filter expenses for previous month
        const prevMonthExpenses = expenses.filter(exp => {
            const expDate = new Date(exp.date);
            return expDate.getMonth() === prevMonth.getMonth() && 
                   expDate.getFullYear() === prevMonth.getFullYear();
        });

        if (prevMonthExpenses.length > 0) {
            // Save to archives
            const archiveStore = db.transaction('archives', 'readwrite').objectStore('archives');
            await new Promise((resolve, reject) => {
                const request = archiveStore.put({
                    monthKey: monthKey,
                    expenses: prevMonthExpenses,
                    finalBalance: walletBalance,
                    date: prevMonth.toISOString()
                });
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            // Clear previous month's expenses
            const expenseStore = db.transaction('expenses', 'readwrite').objectStore('expenses');
            for (const exp of prevMonthExpenses) {
                await new Promise((resolve, reject) => {
                    const request = expenseStore.delete(exp.id);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            }

            // Update expenses array
            expenses = expenses.filter(exp => !prevMonthExpenses.includes(exp));
            
            // Reset wallet balance for new month
            await calculateInitialBalance();
            
            // Update display
            updateTable();
            updateWalletDisplay();
            await updateArchiveList();
        }
    }
}

async function updateArchiveList() {
    const archiveStore = db.transaction('archives', 'readonly').objectStore('archives');
    const archives = await new Promise((resolve, reject) => {
        const request = archiveStore.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    const select = document.getElementById('archiveSelect');
    // Keep only the first option (Current Month)
    select.innerHTML = '<option value="">Current Month</option>';
    
    // Add archived months
    archives.sort((a, b) => new Date(b.date) - new Date(a.date))
           .forEach(archive => {
               const option = document.createElement('option');
               option.value = archive.monthKey;
               option.textContent = archive.monthKey;
               select.appendChild(option);
           });
}

async function loadArchivedMonth() {
    const select = document.getElementById('archiveSelect');
    const monthKey = select.value;

    if (!monthKey) {
        updateTable();
        return;
    }

    const archiveStore = db.transaction('archives', 'readonly').objectStore('archives');
    const archive = await new Promise((resolve, reject) => {
        const request = archiveStore.get(monthKey);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    if (archive) {
        const tableBody = document.getElementById('expenseTable');
        tableBody.innerHTML = '';
        
        archive.expenses.forEach(expense => {
            const row = document.createElement('tr');
            const date = new Date(expense.date);
            row.innerHTML = `
                <td>${date.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })}</td>
                <td>${expense.amount.toFixed(2)}</td>
                <td class="${expense.walletBalance >= 0 ? 'positive' : 'negative'}">
                    ${expense.walletBalance.toFixed(2)}
                </td>
                <td>
                    <button disabled class="delete-button" style="background-color: #9e9e9e;">
                        <span class="material-icons">archive</span>
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    }
}

function updateCurrentMonth() {
    const now = new Date();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('currentMonth').textContent = 
        `Current Month: ${monthNames[now.getMonth()]} ${now.getFullYear()}`;
}

// Initialize when page loads
async function initialize() {
    await loadData();
    await checkAndArchive();
    await updateArchiveList();
    updateCurrentMonth();
    setInterval(getCurrentTime, 60000);
    setInterval(checkAndArchive, 3600000); // Check every hour
    setInterval(checkDailyAddition, 3600000); // Check for daily additions every hour
}

// Start the application
initialize(); 
