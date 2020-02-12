/**
 *
 * Bid Strategy Performance Monitor
 *
 * This script allows Google Ads MCC Accounts to monitor the performance
 * of various budgets on child accounts based on defined
 * metrics.
 *
 * Version: 1.0
 * Google Ads Script maintained on brainlabsdigital.com
 *
 **/

//////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////

//Options

//Spreadsheet URL

var SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/u/0/d/1pQ-m0OypEmOmV73pKfbh38xzGuqosEuKvCjVaDEgUzI/edit';

//Ignore Paused Campaigns

// Set to 'false' to include paused campaigns in data.

var ignorePausedCampaigns = true;

//////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////

// Metrics

// Metrics are written onto output sheet in order stated below. Read the 'Metric'
// column of the Google Ads documentation to find other metrics to include:
// https://developers.google.com/adwords/api/docs/appendix/reports/campaign-performance-report

var METRICS = [
    'AverageCpc',
    'Clicks',
    'Conversions',
    'Cost',
    'Ctr',
    'Impressions'
];

// Indices

var INPUT_HEADER_ROW = 1;
var INPUT_DATA_ROW = 3;
var OUTPUT_HEADER_ROW = 2;

//////////////////////////////////////////////////////////////////////////////

// Functions

function main() {

    var spreadsheet = getSpreadsheet(SPREADSHEET_URL);
    var inputSheet = spreadsheet.getSheetByName("Input");
    var outputSheet = spreadsheet.getSheetByName("Output");

    var tz = AdsApp.currentAccount().getTimeZone();

    //Store Sheet Headers and Indices

    var inputHeaders = inputSheet.getRange(INPUT_HEADER_ROW + ":" + INPUT_HEADER_ROW).getValues()[0];
    var statusColumnIndex = inputHeaders.indexOf("Status");
    var accountIDColumnIndex = inputHeaders.indexOf("Account ID");
    var accountNameColumnIndex = inputHeaders.indexOf("Account Name")
    var campaignNameContainsIndex = inputHeaders.indexOf("Campaign Name Contains");
    var campaignNameDoesNotContainIndex = inputHeaders.indexOf("Campaign Name Doesn't Contain");
    var contactEmailsColumnIndex = inputHeaders.indexOf("Contact email(s)")
    var startDateColumnIndex = inputHeaders.indexOf("Start Date");
    var endDateColumnIndex = inputHeaders.indexOf("End Date");
    var outputHeaders = outputSheet.getRange(OUTPUT_HEADER_ROW + ":" + OUTPUT_HEADER_ROW).getValues()[0];
    var timeRunIndex = outputHeaders.indexOf("Time Run");

    //Get all rows of data.

    var allData = inputSheet.getRange(INPUT_DATA_ROW, 1, inputSheet.getLastRow() - (INPUT_HEADER_ROW + 1), inputSheet.getLastColumn()).getValues();

    //For each row of data:
    Logger.log("Verifying each row of data...")
    for (var i = 0; i < allData.length; i++) {
        var row = allData[i];
        if (row[statusColumnIndex] == "Paused") {
            continue;
        };
        var accountName = row[accountNameColumnIndex];
        var contacts = (row[contactEmailsColumnIndex]).split(',').map(function (item) {
            return item.trim();
        });
        var childAccount = getAccountId(row[accountIDColumnIndex], contacts, accountName);
        AdsManagerApp.select(childAccount);
        var dates = getDates([row[startDateColumnIndex], row[endDateColumnIndex]], tz, contacts, accountName);
        var combinedQueries = makeQueries(dates, row[campaignNameContainsIndex], row[campaignNameDoesNotContainIndex])
        var budgetData = getBudgetData(combinedQueries, contacts, accountName);
        var accountCurrencyCode = getAccountCurrencyCode();
        var accountDataRow = [row[accountNameColumnIndex], row[accountIDColumnIndex]]
        outputRows = budgetData.map(function (budgetDataRow) {
            return accountDataRow.concat(budgetDataRow.map(function (field) {
                return field.value;
            })).concat([accountCurrencyCode])
        });
        Logger.log(outputRows)
        writeRowsOntoSheet(outputSheet, outputRows);
    }
    Logger.log("Success.")
}

function getSpreadsheet(spreadsheetUrl) {
    Logger.log('Checking spreadsheet: ' + SPREADSHEET_URL + ' is valid.');
    if (spreadsheetUrl.replace(/[AEIOU]/g, "X") == "https://docs.google.com/YXXR-SPRXXDSHXXT-XRL-HXRX") {
        throw ("Problem with " + SPREADSHEET_URL +
            " URL: make sure you've replaced the default with a valid spreadsheet URL."
        );
    }
    try {
        var spreadsheet = SpreadsheetApp.openByUrl(spreadsheetUrl);

        var sheet = spreadsheet.getSheets()[0];
        var sheetName = sheet.getName();
        sheet.setName(sheetName);

        return spreadsheet;
    } catch (e) {
        throw ("Problem with " + SPREADSHEET_URL + " URL: '" + e + "'. You may not have edit access");
    }
}

function getAccountId(accountId, contacts, accountName) {
    var childAccount = AdsManagerApp.accounts().withIds([accountId]).get();
    if (childAccount.hasNext()) {
        return childAccount.next();
    } else {
        MailApp.sendEmail({
            to: contacts.join(),
            subject: "Bid Strategy Performance Monitor: error with account " + accountName,
            htmlBody: "Could not find account with ID: " + accountId + "."
        });
        throw ("Could not find account with ID: " + accountId);
    }

}

function getDates(dates, tz, contacts, accountName) {
    var validatedDates = dates.map(function (date) {
        if (date.length === 0) {
            var today = new Date()
            return Utilities.formatDate(today, tz, 'yyyyMMdd');
        } else {
            return Utilities.formatDate(new Date(date), tz, 'yyyyMMdd');
        }
    })
    if (validatedDates[0] <= validatedDates[1]) {
        return validatedDates;
    } else {
        MailApp.sendEmail({
            to: contacts.join(),
            subject: "Bid Strategy Performance Monitor: error with account " + accountName,
            htmlBody: ("Invalid date ranges (yyyMMdd): End Date: " +
                validatedDates[1] + " precedes Start date: " + validatedDates[0])
        })
        throw ("Invalid date ranges: End Date precedes Start Date.");
    }
}

function makeQueries(dates, campaignNameContains, campaignNameDoesNotContain) {
    var campaignNameContains = campaignNameContains.split(',').map(function (item) {
        return item.trim();
    });
    var campaignNameDoesNotContain = campaignNameDoesNotContain.split(',').map(function (item) {
        return item.trim();
    });
    var campaignFilterQueries = makeCampaignFilterStatements(campaignNameContains, campaignNameDoesNotContain, ignorePausedCampaigns);
    var combinedQueries = combineQueries(dates, campaignFilterQueries);
    return combinedQueries;
}

function makeCampaignFilterStatements(campaignNameContains, campaignNameDoesNotContain, ignorePausedCampaigns) {
    var whereStatement = "WHERE BudgetStatus != REMOVED ";
    var whereStatementsArray = [];


    if (ignorePausedCampaigns) {
        whereStatement += "AND AssociatedCampaignStatus = ENABLED ";
    } else {
        whereStatement += "AND AssociatedCampaignStatus IN ['ENABLED','PAUSED'] ";
    }

    for (var i = 0; i < campaignNameDoesNotContain.length; i++) {
        if (campaignNameDoesNotContain == "") {
            break;;
        } else {
            whereStatement += "AND AssociatedCampaignName DOES_NOT_CONTAIN_IGNORE_CASE '" +
                campaignNameDoesNotContain[i].replace(/"/g, '\\\"') + "' ";
        }
    }

    if (campaignNameContains.length == 0) {
        whereStatementsArray = [whereStatement];

    } else {
        for (var i = 0; i < campaignNameContains.length; i++) {
            whereStatementsArray.push(whereStatement + 'AND AssociatedCampaignName CONTAINS_IGNORE_CASE "' +
                campaignNameContains[i].replace(/"/g, '\\\"') + '" '
            );
        }
    }
    return whereStatementsArray;
}


function combineQueries(dates, campaignFilterQueries) {
    var combinedQueries = []
    for (var i = 0; i < campaignFilterQueries.length; i++) {
        combinedQueries.push(campaignFilterQueries[i]
            .concat(" DURING " + dates[0] + "," + dates[1]));
    }
    return combinedQueries;
}

function getAccountCurrencyCode() {
    var report = AdsApp.report("SELECT AccountCurrencyCode FROM ACCOUNT_PERFORMANCE_REPORT");
    var reportRow = report.rows().next();
    return reportRow["AccountCurrencyCode"]
}

function getBudgetData(queries, contacts, accountName) {
    dataRows = []
    var predefinedFields = ["BudgetName", "BudgetId", "BudgetReferenceCount"]
    var fields = predefinedFields.concat(METRICS).concat(["Amount"]);
    for (var i = 0; i < queries.length; i++) {
        var report = AdsApp.report(
            "SELECT " + fields.map(function (field) {
                return field;
            }).join(',') + " FROM BUDGET_PERFORMANCE_REPORT " + queries[i]
        );
        var budgetIds = [];
        var reportRows = report.rows();
        while (reportRows.hasNext()) {
            var reportRow = reportRows.next();
            if (budgetIds.indexOf(reportRow["BudgetId"]) == -1) {
                budgetIds.push(reportRow["BudgetId"]);
                var dataRow = fields.map(function (field) {
                    return {
                        name: field,
                        value: reportRow[field] || "N/A"
                    };
                });
                dataRows.push(dataRow)
            }
        }
    }
    if (reportRows.hasNext() === false) {
        MailApp.sendEmail({
            to: contacts.join(),
            subject: "Bid Strategy Performance Monitor: error with account " + accountName,
            htmlBody: "No campaigns found with the given settings: " + queries[i]
        });
    }
    return dataRows;
}

function writeRowsOntoSheet(sheet, rows) {
    for (var i = 0; i < 5; i++) {
        try {
            for (var i = 0; i < rows.length; i++) {
                row = rows[i];
                sheet.getRange((sheet.getLastRow() + 1), 1, 1, row.length).setValues([row]);
            }
        } catch (e) {
            if (e == "Exception: This action would increase the number of cells in the worksheet above the limit of 2000000 cells.") {
                Logger.log("Could not write to spreadsheet: '" + e + "'");
                try {
                    sheet.getRange("R" + (sheet.getLastRow() + 2) + "C1")
                        .setValue("Not enough space to write the data - try again in an empty spreadsheet");
                } catch (e2) {
                    Logger.log("Error writing 'not enough space' message: " + e2);
                }
                break;
            }
            if (i == 4) {
                Logger.log("Could not write to spreadsheet: '" + e + "'");
            }
        }
    }
}

function setDate(sheet, columnIndex) {
    var now = new Date();
    sheet.getRange((sheet.getLastRow()), columnIndex + 1).setValue(now);
}
