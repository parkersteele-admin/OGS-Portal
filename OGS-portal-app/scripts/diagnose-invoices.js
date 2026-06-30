"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Diagnostic script to check invoice vs order data consistency
 * Usage: npx ts-node scripts/diagnose-invoices.ts
 */
var app_1 = require("firebase-admin/app");
var firestore_1 = require("firebase-admin/firestore");
// Initialize Firebase Admin SDK
if (!(0, app_1.getApps)().length) {
    (0, app_1.initializeApp)();
}
var db = (0, firestore_1.getFirestore)();
function diagnoseInvoices() {
    return __awaiter(this, void 0, void 0, function () {
        var sentInvoices, overdueInvoices, paidInvoices, invoiceSentOrders, paidOrders, allInvoices, allOrders, mismatchCount, _i, _a, invDoc, inv, orderDoc, order, error_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log('\n📊 INVOICE DATA CONSISTENCY CHECK\n');
                    console.log('='.repeat(70));
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 13, , 14]);
                    // Get all invoices with status 'sent'
                    console.log('\n1️⃣  INVOICES WITH STATUS "sent"\n');
                    return [4 /*yield*/, db.collection('invoices')
                            .where('status', '==', 'sent')
                            .get()];
                case 2:
                    sentInvoices = _b.sent();
                    console.log("   Found: ".concat(sentInvoices.size, " invoices\n"));
                    sentInvoices.docs.forEach(function (doc) {
                        var _a, _b;
                        var data = doc.data();
                        console.log("   \u2022 ".concat(data.invoiceNumber, " (").concat(doc.id, ")"));
                        console.log("     Customer: ".concat(data.customerId));
                        console.log("     Total: $".concat((data.total || 0).toFixed(2)));
                        console.log("     Order ID: ".concat(data.orderId || 'none'));
                        console.log("     Issued: ".concat((_b = (_a = data.issuedAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a).toLocaleDateString()));
                        console.log("     Status: ".concat(data.status, "\n"));
                    });
                    // Get all invoices with status 'overdue'
                    console.log('\n2️⃣  INVOICES WITH STATUS "overdue"\n');
                    return [4 /*yield*/, db.collection('invoices')
                            .where('status', '==', 'overdue')
                            .get()];
                case 3:
                    overdueInvoices = _b.sent();
                    console.log("   Found: ".concat(overdueInvoices.size, " invoices\n"));
                    overdueInvoices.docs.forEach(function (doc) {
                        var _a, _b;
                        var data = doc.data();
                        console.log("   \u2022 ".concat(data.invoiceNumber, " (").concat(doc.id, ")"));
                        console.log("     Customer: ".concat(data.customerId));
                        console.log("     Total: $".concat((data.total || 0).toFixed(2)));
                        console.log("     Due: ".concat((_b = (_a = data.dueAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a).toLocaleDateString()));
                        console.log("     Status: ".concat(data.status, "\n"));
                    });
                    // Get all invoices with status 'paid'
                    console.log('\n3️⃣  INVOICES WITH STATUS "paid"\n');
                    return [4 /*yield*/, db.collection('invoices')
                            .where('status', '==', 'paid')
                            .get()];
                case 4:
                    paidInvoices = _b.sent();
                    console.log("   Found: ".concat(paidInvoices.size, " invoices\n"));
                    paidInvoices.docs.forEach(function (doc) {
                        var _a, _b;
                        var data = doc.data();
                        console.log("   \u2022 ".concat(data.invoiceNumber, " (").concat(doc.id, ")"));
                        console.log("     Customer: ".concat(data.customerId));
                        console.log("     Total: $".concat((data.total || 0).toFixed(2)));
                        console.log("     Paid At: ".concat((_b = (_a = data.paidAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a).toLocaleDateString()));
                        console.log("     Status: ".concat(data.status, "\n"));
                    });
                    // Get all orders with invoice status
                    console.log('\n4️⃣  ORDERS WITH INVOICE_SENT STATUS\n');
                    return [4 /*yield*/, db.collection('orders')
                            .where('status', '==', 'invoice_sent')
                            .get()];
                case 5:
                    invoiceSentOrders = _b.sent();
                    console.log("   Found: ".concat(invoiceSentOrders.size, " orders\n"));
                    invoiceSentOrders.docs.forEach(function (doc) {
                        var data = doc.data();
                        console.log("   \u2022 Order ".concat(doc.id));
                        console.log("     Customer: ".concat(data.customerId));
                        console.log("     QB Invoice #: ".concat(data.qbInvoiceNumber || 'none'));
                        console.log("     Invoice Amount: $".concat((data.invoiceAmount || 0).toFixed(2)));
                        console.log("     Status: ".concat(data.status, "\n"));
                    });
                    // Get orders marked as paid
                    console.log('\n5️⃣  ORDERS WITH PAID STATUS\n');
                    return [4 /*yield*/, db.collection('orders')
                            .where('status', '==', 'paid')
                            .get()];
                case 6:
                    paidOrders = _b.sent();
                    console.log("   Found: ".concat(paidOrders.size, " orders\n"));
                    paidOrders.docs.forEach(function (doc) {
                        var data = doc.data();
                        console.log("   \u2022 Order ".concat(doc.id));
                        console.log("     Customer: ".concat(data.customerId));
                        console.log("     QB Invoice #: ".concat(data.qbInvoiceNumber || 'none'));
                        console.log("     Paid Amount: $".concat((data.paidAmount || 0).toFixed(2)));
                        console.log("     Status: ".concat(data.status, "\n"));
                    });
                    return [4 /*yield*/, db.collection('invoices').get()];
                case 7:
                    allInvoices = _b.sent();
                    console.log('\n📈 INVOICE SUMMARY\n');
                    console.log("   Total Invoices: ".concat(allInvoices.size));
                    console.log("   - Sent: ".concat(sentInvoices.size));
                    console.log("   - Overdue: ".concat(overdueInvoices.size));
                    console.log("   - Paid: ".concat(paidInvoices.size));
                    return [4 /*yield*/, db.collection('orders').get()];
                case 8:
                    allOrders = _b.sent();
                    console.log("\n\uD83D\uDCC8 ORDER SUMMARY\n");
                    console.log("   Total Orders: ".concat(allOrders.size));
                    console.log("   - Invoice Sent: ".concat(invoiceSentOrders.size));
                    console.log("   - Paid: ".concat(paidOrders.size));
                    // Check for mismatches
                    console.log('\n⚠️  POTENTIAL ISSUES\n');
                    mismatchCount = 0;
                    _i = 0, _a = allInvoices.docs;
                    _b.label = 9;
                case 9:
                    if (!(_i < _a.length)) return [3 /*break*/, 12];
                    invDoc = _a[_i];
                    inv = invDoc.data();
                    if (!inv.orderId) return [3 /*break*/, 11];
                    return [4 /*yield*/, db.collection('orders').doc(inv.orderId).get()];
                case 10:
                    orderDoc = _b.sent();
                    if (orderDoc.exists) {
                        order = orderDoc.data();
                        if (order.qbInvoiceNumber !== inv.invoiceNumber) {
                            mismatchCount++;
                            console.log("   \u26A0\uFE0F  Invoice ".concat(inv.invoiceNumber, " (orderId: ").concat(inv.orderId, ")"));
                            console.log("       Order has qbInvoiceNumber: ".concat(order.qbInvoiceNumber || 'none'));
                        }
                    }
                    _b.label = 11;
                case 11:
                    _i++;
                    return [3 /*break*/, 9];
                case 12:
                    if (mismatchCount === 0) {
                        console.log('   ✓ No invoice/order number mismatches found');
                    }
                    console.log('\n' + '='.repeat(70));
                    console.log('✅ Diagnosis complete\n');
                    return [3 /*break*/, 14];
                case 13:
                    error_1 = _b.sent();
                    console.error('❌ Error:', error_1);
                    return [3 /*break*/, 14];
                case 14:
                    process.exit(0);
                    return [2 /*return*/];
            }
        });
    });
}
diagnoseInvoices();
