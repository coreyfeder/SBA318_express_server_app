const express = require("express");
// const bodyParser = require("body-parser")
const fs = require("fs");
const util = require("node:util");
const { exit } = require("process");

const app = express();
const router = express.Router();
// Apparently it's _critical_ to mount the decoders before mounting the router.
// Wish they'd told us that. Hard enough dancing around this arbitrary and
// annoying "middleware" convention; we also have to deal with getting torpedoed
// by undocumented exceptions? Screw you too, Express.
app.use(express.json());
app.use(express.urlencoded((extended = true)));
app.use("/", router); // mount the router on the app

// this endpoint
const protocol = "http";
const host = "localhost";
const port = 3000;
const url = `${protocol}://${host}:${port}`;

// No database for this. Just some flat files.
// Make that sdone flat file. Dataset is ver smol.
// No sync!! Do NOT run multiple instances!!
const dataFilename = "APIzza.json";
const serverPath = ".";
const dataFile = `${serverPath}/${dataFilename}`;

// SBA Note:
// Not going to deal with sync or race conditions or missing files or any such for this exercise.

// If I declare this in the `try`, it won't esccape the block scope.
// I need to assign it to something in the global scope. Without using `var`.
let dataHolder;
try {
    dataHolder = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    console.log("Data loaded.");
} catch (err) {
    console.error("Data file failed to load!");
    console.error(err);
    exit(1);
}
// but I want it to be a `const`. For security.
const data = dataHolder;

// MIDDLEWARE

function saveData() {
    // janky JSON file or not, make the data persist
    try {
        fs.writeFileSync(dataFile, JSON.stringify(data));
        console.log("Data saved.");
    } catch (err) {
        console.error("Data failed to save!");
        console.error(err);
    }
}

// IMPORTANT
// TODO: move things to other files. this is a MESS.

function sanitizeString(text) {
    // Sanitization function from mwag (https://stackoverflow.com/users/3160967/mwag) at StackOverflow, with edits
    // https://stackoverflow.com/questions/24229262/match-non-printable-non-ascii-characters-and-remove-from-text/71459309#71459309
    // strip control chars, trim, normalize whitespace
    text = String(text).trim();
    text = text.replace(/\p{C}/gu, "");
    // overkill: normalize whitespace and strip newlines
    text = text.replace(/\s/gu, " ");
    text = text.replace(/[\n\r]+/g, " ");
    text = text.replace(/[\p{Zl}]+/gu, " ");
    text = text.replace(/[\p{Zp}]+/gu, " ");
    text = text.replace(/[\p{Zs}]+/gu, " ");
    text = text.replace(/\s/gu, " ");

    return text;
}

function sanitizeObject(uncleanObject, validProperties) {
    let cleanObject = {};
    for (let property of validProperties) {
        switch (typeof uncleanObject[property]) {
            case "number":
            case "boolean":
                cleanObject[property] = uncleanObject[property];
                break;
            case "string":
                cleanObject[property] = sanitizeString(uncleanObject[property]);
                break;
            case "object":
                cleanObject[property] = JSON.parse(
                    JSON.stringify(sanitizeString(uncleanObject[property])),
                );
                break;
            default:
                cleanObject[property] = null;
        }
    }
    return cleanObject;
}

function sanitizeCustomer(potentialCustomer) {
    let result = {success: null, error: null}
    let newCustomer = sanitizeObject(potentialCustomer, [
        "name",
        "phone",
        "address",
        "delivery_notes",
    ]);
    if (newCustomer == {}) {
        result.error = "Invalid customer data"
        return result
    }
    let missingFields = ""
    if (!newCustomer.name) { missingFields += ", Name"; }
    if (!newCustomer.phone) { missingFields += ", Phone"; }
    if (!newCustomer.address) { missingFields += ", Address"; }
    missingFields = missingFields.slice(2)
    if (missingFields) {
        result.error = `Missing required fields for new customer: ${missingFields}`
        return result
    } else {
        result.success = newCustomer
        return result;
    }
}

function addNewCustomer(newCustomer) {
    let maxCurrentCustomerId = data.customers[data.customers.length - 1].customer_id;
    newCustomer.customer_id = maxCurrentCustomerId + 1;
    data.customers.push(newCustomer);
    saveData();
    return newCustomer;
}

function sanitizeOrder(potentialOrder) {
    console.log("potentialOrder")
    console.log(potentialOrder)
    let result = {success: null, error: null}
    if (potentialOrder == {}) {
        result.error = "Invalid order data"
    } else if (!potentialOrder.customer_id) {
        result.error = "Missing required fields for new order"
    } else {
        // no other sanitization. the customer is always right!
        result.success = potentialOrder;
    }
    return result
}

function addNewOrder(newOrder) {
    // keeping order number unique across launches
    console.log(`adding new order`)
    console.log(`current newOrder: ${newOrder}`)
    console.log(`current order_count: ${data.orders_next_id}`)
    newOrder.order_id = data.orders_next_id++;  // assign first, then increment
    data.orders.push(newOrder);
    saveData();
    console.log(`new newOrder: ${newOrder}`)
    console.log(`new order_count: ${data.orders_next_id}`)
    return newOrder;
}

function findCustomerById(customer_id) {
    return data.customers.find((item) => item.customer_id == customer_id)
}

function findOrderById(order_id) {
    return data.orders.find((item) => item.order_id == order_id)
}

function findOrderIndexById(order_id) {
    return data.orders.findIndex((item) => item.order_id == order_id)
}

// ROUTER

// use a router to log the transactions
router.use((req, res, next) => {
    // console.log(req.body)
    console.log(
        [
            Date.now(),
            "req",
            req.method,
            req.path,
            // JSON.stringify(req.body),
        ].join(" : "),
    );
    console.log(req.body);
    next();
});

// ROUTES

// customers
//  > GET == list customers
app.route("/customers").get((req, res) => {
    res.json(data.customers);
});

// customer/:customer_id
//  > GET = list customer
app.route("/customer/:customer_id").get((req, res) => {
    let foundCustomer = findCustomerById(req.params.customer_id);
    if (foundCustomer) {
        res.json(foundCustomer);
    } else {
        res.status(404).json({ error: `Resource not found.` });
    }
});

// customer
//  > POST = add new customer
app.route("/customer").post((req, res) => {
    let newCustomer = sanitizeCustomer(req.body);
    console.debug("post-sanitation:")
    console.debug(newCustomer)
    if (newCustomer.success) {
        // TODO: check that customer doesn't already exist. NBD if they do, but to be tidy.
        let confirmation = addNewCustomer(newCustomer.success);
        res.json(confirmation);
    } else {
        res.status(403).send(newCustomer.error);
    }
});

// toppings
//  > GET = list toppings
//  > POST = add toppings  (expects a list of strings)
app.route("/toppings")
    .all((req, res, next) => {
        console.debug("endpoint: /toppings");
        next();
    })
    .get((req, res) => {
        res.json(data.toppings);
    })
    .post((req, res) => {
        // console.log("/toppings/post")
        // console.log(req.body)
        let newToppings = req.body;
        if (Array.isArray(newToppings)) {
            for (let topping of newToppings) {
                if (typeof topping == "string") {
                    let newTopping = sanitizeString(topping);
                    if (!data.toppings.includes(newTopping)) {
                        data.toppings.push(newTopping);
                        console.log(`Adding topping: ${newTopping}`);
                    }
                }
            }
        }
        saveData()
        res.json(data.toppings);
    });

// orders
//  > GET = list orders
app.route("/orders").get((req, res) => {
    console.debug("endpoint: /orders");
    console.debug(data.orders);
    res.send(data.orders);
});

// order/:order_id
//  > GET = list specified order
app.route("/order/:order_id")
    .get((req, res) => {
        let foundOrder = findOrderById(req.params.order_id);
        if (foundOrder) {
            res.json(foundOrder);
        } else {
            res.status(404).json({ error: `Resource not found.` });
        }
    })
    .delete((req, res) => {
        let foundOrderIndex = findOrderIndexById(req.params.order_id);
        if (foundOrderIndex >= 0) {
            let removed = data.orders.splice(foundOrderIndex,1);
            saveData()
            res.json(removed)
        } else {
            res.status(404).json({ error: `Resource not found.` });
        }
    });

// order
//  > POST = add a new order
app.route("/order").post((req, res) => {
    // console.debug("POSTing a new order");
    let newOrder = sanitizeOrder(req.body);
    console.log("newOrder")
    console.log(newOrder)
    // TODO: validate the order
    //  - customer_id must exist
    //  - size must be valid
    //  - toppings must exist (or maybe be automatically added?)
    if (newOrder.success) {
        let confirmation = addNewOrder(newOrder.success)
        res.json(confirmation)
    } else {
        res.status(403).json({error: newOrder.error});
    }
});

// ERROR HANDLING / endware
//   If a call made it this far, something was wrong with it.

// catch any request sent without the prefix
app.all("/*", (req, res) => {
    res.status(403).json({
        error: `Welcome to APIzza! Public endpoints are available at: ${url}`,
    });
});

// any other resource request
app.use((req, res, next) => {
    console.log(
        [
            Date.now(),
            "404",
            req.method,
            req.path,
            // JSON.stringify(req.body),
        ].join(" : "),
    );
    res.status(404).json({error: "Resource not found."});
});

// any other...other?
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(404).json({error: `Error accessing resource. ${err}`});
});

// GO / LISTEN

app.listen(port, () => {
    console.log(`APIzza server listening at:  ${url}`);
});
