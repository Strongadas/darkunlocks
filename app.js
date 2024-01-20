//jshint esversion:6
require('dotenv').config();
const express = require('express')
const bodyParser = require('body-parser')
const ejs = require ('ejs')
const mongoose = require ("mongoose")
const session = require('express-session')
const passportLocalMongoose = require('passport-local-mongoose')
const passport = require('passport')
const nodemailer = require('nodemailer');
const Redis = require('ioredis');
const MongoDBStore = require('connect-mongodb-session')(session);
const schedule = require('node-schedule');
const paypal = require('paypal-rest-sdk')
const axios = require('axios'); 
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const flash = require('connect-flash');
const multer = require('multer');

paypal.configure({
    mode: 'live', 
    client_id:  process.env.PAYPAL_CLIENT_ID ,
    client_secret: process.env.PAYPAL_SECRET_KEY
})

const PUBLISHABLE_KEY = process.env.STRIPE_PUBLISH_KEY
const SECRET_KEY = process.env.STRIPE_SECRET_KEY
const stripe  = require('stripe')(SECRET_KEY)

// Set up multer for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });


const app = express()



mongoose.connect(process.env.DATABASE_URL)
mongoose.set('strictQuery', false);



app.use(express.static('public'))
app.set('view engine','ejs')
app.set('views', __dirname + '/views')
app.use(bodyParser.urlencoded({extended:true}))
app.use(bodyParser.json())
app.use(flash());

//const binancePay = new BinancePay(apiKey, apiSecret);

app.use(session({
    secret:process.env.SECRET,
    resave:false,
    saveUninitialized:false
}))
app.use(passport.initialize())
app.use(passport.session())


const userSchema = new mongoose.Schema({
    
    username:String,
    password: String,
    name:String,
    balance: {
        type: Number,
        default: 0, 
    },
    paidCredits: {type:Number,default:0},
    unpaidCredits: {type:Number,default:0},
    isAdmin: { type: Boolean, default: false },
    waitingAction: {type:Number,default:0},
    inprocess:{type:Number,default:0},
    success:{type:Number,default:0},
    rejected:{type:Number,default:0},
    cancelled:{type:Number,default:0},
    imei: [
        {
            imeiNumber: { type: String, required: true },
            price: { type: Number, default: 0 },
            service:{ type: String },
            status: { type: String, enum: ['waiting', 'inprocess', 'success', 'rejected'], default: 'waiting' },
        }
    ],
    addedAt: {
        type: Date,
        default: Date.now,
    }


});
userSchema.plugin(passportLocalMongoose)



const User = new mongoose.model('User',userSchema)

passport.use(User.createStrategy())
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    User.findById(id, (err, user) => {
        done(err, user);
    });
});



  const isAdmin = (req, res, next) => {
    if (req.isAuthenticated() && req.user.isAdmin) {
        return next(); // User is an admin, proceed to the next middleware
    }
    res.redirect('/dash'); // Redirect to the home page or login page if not an admin
};

// Define a middleware to check if the user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    // Redirect unauthenticated users to the login page or any other appropriate route
    res.redirect('/login');
}


// Job to transition from 'waiting' to 'inprocess' every 3 minutes
const transitionToInprocessJob = schedule.scheduleJob('*/3 * * * *', async () => {
    const users = await User.find({ waitingAction: { $gt: 0 } });

    for (const user of users) {
        user.inprocess += user.waitingAction;
        user.waitingAction = 0;
        user.addedAt = new Date();
        await user.save();
    }
});

// Job to transition from 'inprocess' to 'rejected' after 10 hours
const transitionToRejectedJob = schedule.scheduleJob(new Date(Date.now() + 10 * 60 * 60 * 1000), async () => {
    const users = await User.find({ inprocess: { $gt: 0 } });

    for (const user of users) {
        for (const imei of user.imei) {
            if (imei.status === 'inprocess') {
                imei.status = 'rejected';
            }
        }

        await user.save();
    }
});


function getColor(status) {
    switch (status) {
        case 'waiting':
            return 'blue';
        case 'inprocess':
            return 'orange';
        case 'rejected':
            return 'red';
        case 'success':
            return 'green';
        default:
            return 'black'; // Default color or handle other cases
    }
}

// Make the getColor function available to the EJS template
app.locals.getColor = getColor;


app.get('/transfer', ensureAuthenticated, async (req, res) => {
    const user_email = req.user.username
    const user_balance = req.user.balance
    console.log(user_email, user_balance)
    res.render('transfer', { message: null, error: null ,user_balance,user_email});
       
});
app.post('/transfer', ensureAuthenticated, async(req,res)=>{

        function sendUpdate(){

            // Send a confirmation email to the user
            const senderEmail = req.user.username;
            const recipientEmail = req.body.recipientUser; 
            const amountToSend = parseInt(req.body.amount);
            const subject = 'Trasnfer Confirmation';
            const message = `Your Transfer was successfully placed. Your trabsfer details: reciept: ${recipientEmail} Amount: $ ${amountToSend}`;

            const emailTemplate = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Transfer Confirmation</title>
                    </head>
                    <body style="font-family: Arial, sans-serif;">

                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <h2 style="color: #4CAF50;">Order Successfully Placed</h2>
                        </div>

                        <div style="padding: 20px;">
                            <p>Your Transfer was successfully Sent. Here are your transfer details:</p>
                            
                            <ul style="list-style-type: none; padding: 0; margin: 0;">
                                <li>Sender: <strong>${senderEmail}</strong></li>
                                <li>Reciept: <strong>${recipientEmail}</strong></li> 
                                <li>Amount: <strong>$ ${amountToSend}</strong></li>
                                
                            </ul>
                        </div>

                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <p style="color: #888;">Thank you for choosing Dark Unlocks!</p>
                        </div>

                    </body>
                    </html>
                `;


            const transporter = nodemailer.createTransport({
                service: 'gmail',
                port: 456,
                secure: true,
                auth: {
                    user: "darkunlocks1@gmail.com",
                    pass: "nnzw lyec ivtj soyw"
                }
            });

            const mailOptions = {
                from: 'darkunlocks1@gmail.com',
                to: senderEmail,
                subject: subject,
                html: emailTemplate,
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Error sending email notification:', error);
                } else {
                    console.log('Email notification sent:', info.response);
                }
            });
        }

            try{

            const senderUserId = req.body.senderUserId;
            const recipientEmail = req.body.recipientUser; 
            const amountToSend = parseInt(req.body.amount);

            console.log(senderUserId, recipientEmail , amountToSend)

            if (!senderUserId || !recipientEmail || isNaN(amountToSend)) {
                return res.status(400).json({ error: 'Invalid parameters' });
            }

            const senderUser = await User.findOne({username: senderUserId});
            const recipientUser = await User.findOne({ username: recipientEmail });

                console.log(senderUser,recipientUser)

            if (!senderUser || !recipientUser) {
                return res.status(404).json({ error: 'Sender or recipient not found' });
            } if (senderUser.balance >= amountToSend) {
                senderUser.balance -= amountToSend;
                recipientUser.balance += amountToSend;

                await senderUser.save();
                await recipientUser.save();

                res.render('transfer-sucessfully',{senderUser,recipientUser,amountToSend})
                sendUpdate()
                recieptEmail()
            } else {
                return res.status(400).json({ error: 'Insufficient balance for the transfer.' });
            }
        } catch (error) {
            console.error('Error during balance transfer:', error.message);
            return res.status(500).json({ error: 'Internal server error' });
        }


        function sendUpdate(){

            // Send a confirmation email to the user
            const senderEmail = req.user.username;
            const recipientEmail = req.body.recipientUser; 
            const amountToSend = parseInt(req.body.amount);
            const subject = 'Trasnfer Confirmation';
            const message = `Your Transfer was successfully sent. Your transfer details: reciept: ${recipientEmail} Amount: $ ${amountToSend}`;

            const emailTemplate = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Transfer Confirmation</title>
                    </head>
                    <body style="font-family: Arial, sans-serif;">

                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <h2 style="color: #4CAF50;">Transfer Successfully Sent</h2>
                        </div>

                        <div style="padding: 20px;">
                            <p>Your Transfer was successfully Sent. Here are your transfer details:</p>
                            
                            <ul style="list-style-type: none; padding: 0; margin: 0;">
                                <li>Sender: <strong>${senderEmail}</strong></li>
                                <li>Reciept: <strong>${recipientEmail}</strong></li> 
                                <li>Amount: <strong>$ ${amountToSend}</strong></li>
                                
                            </ul>
                            <P>Login and check your new balance: http://darkunlocks.onrender.com </p>
                        </div>

                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <p style="color: #888;">Thank you for choosing Dark Unlocks!</p>
                        </div>

                    </body>
                    </html>
                `;


            const transporter = nodemailer.createTransport({
                service: 'gmail',
                port: 456,
                secure: true,
                auth: {
                    user: "darkunlocks1@gmail.com",
                    pass: "nnzw lyec ivtj soyw"
                }
            });

            const mailOptions = {
                from: 'darkunlocks1@gmail.com',
                to: senderEmail,
                subject: subject,
                html: emailTemplate,
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Error sending email notification:', error);
                } else {
                    console.log('Email notification sent:', info.response);
                }
            });
        }
        function recieptEmail(){

            // Send a confirmation email to the user
            const senderEmail = req.user.username;
            const recipientEmail = req.body.recipientUser; 
            const amountToSend = parseInt(req.body.amount);
            const subject = 'Recieved Trasnfer';
            const message = `A Transfer was successfully Sent to you . Transfer details: sender: ${senderEmail} Amount: $ ${amountToSend}`;

            const emailTemplate = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Transfer Recieved</title>
                    </head>
                    <body style="font-family: Arial, sans-serif;">

                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <h2 style="color: #4CAF50;">Recieved Transfer from ${senderEmail}</h2>
                        </div>

                        <div style="padding: 20px;">
                            <p>A Transfer was successfully Sent to you in http://darkunlocks.onrender.com . Here are the transfer details:</p>
                            
                            <ul style="list-style-type: none; padding: 0; margin: 0;">
                                <li>Sender: <strong>${senderEmail}</strong></li>
                                <li>Reciept: <strong>${recipientEmail}</strong></li> 
                                <li>Amount: <strong>$ ${amountToSend}</strong></li>
                                
                            </ul>
                        </div>

                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <p style="color: #888;">Thank you for choosing Dark Unlocks!</p>
                        </div>

                    </body>
                    </html>
                `;


            const transporter = nodemailer.createTransport({
                service: 'gmail',
                port: 456,
                secure: true,
                auth: {
                    user: "darkunlocks1@gmail.com",
                    pass: "nnzw lyec ivtj soyw"
                }
            });

            const mailOptions = {
                from: 'darkunlocks1@gmail.com',
                to: recipientEmail,
                subject: subject,
                html: emailTemplate,
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Error sending email notification:', error);
                } else {
                    console.log('Email notification sent:', info.response);
                }
            });
        }
    
    
})

// Admin dashboard route
app.get('/admin', isAdmin, (req, res) => {
    // Assuming you have a user model
    User.findOne({ _id: req.user._id }, (err, user) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Internal Server Error');
        }

        if (!user) {
            return res.status(404).send('User not found');
        }

         // Render the 'dash' template and pass the user data
             // Fetch the balance data
             const balance = user.balance || 0; 
             const paidCredits = user.paidCredits || 0;
             const unpaidCredits = user.unpaidCredits || 0;
             const waitingAction = user.waitingAction || 0;
             const  inprocess = user.inprocess || 0;
             const success = user.success || 0;
             const rejected = user.rejected || 0;
             const cancelled = user.cancelled || 0;
             
             const allOrders = waitingAction + inprocess + success + rejected + cancelled
             const totalBalance = (user.balance || 0) + (user.paidCredits || 0) + (user.unpaidCredits || 0);
             // Render the 'dash' view and pass the user and balance data
             res.render('admin', { user: user, balance: balance, paidCredits: paidCredits, unpaidCredits: unpaidCredits , waitingAction: waitingAction ,inprocess:inprocess ,success:success,rejected:rejected, cancelled:cancelled , allOrders:allOrders,totalBalance});
    });
});


app.get('/users', isAdmin, async (req, res) => {
    try {
        // Fetch all users from your database
       // const users = await User.find();
        //const userCount = await User.countDocuments();
        let query = {};

        // Check if a search query is provided
        if (req.query.search) {
            const searchQuery = req.query.search;
            query = {
                $or: [
                    { name: { $regex: searchQuery, $options: 'i' } }, // Case-insensitive search by name
                    { username: { $regex: searchQuery, $options: 'i' } }, // Case-insensitive search by email
                ],
            };
        }

        // Fetch users based on the query
        const users = await User.find(query);
        const userCount = await User.countDocuments(query);
        

        // Render the admin users template and pass the user data
        res.render('users', { users, userCount });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal server error');
    }
});


// Edit user route
app.get('/users/:userId/user-edit', isAdmin, async (req, res) => {
    try {
        const userId = req.params.userId;
        // Fetch user information by userId from your database
        const user = await User.findById(userId);
         // Fetch all IMEI numbers associated with the user
         const imeiOrders = user.imei || [];
        


        // Render the user edit template and pass the user data
        res.render('user-edit', { user, imeiOrders });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal server error');
    }
});

app.post('/users/:userId/edit', isAdmin, async (req, res) => {
    try {
        const userId = req.params.userId;
        // Parse the form data and retrieve the new balance from the request body
        const { name, username, isAdmin, newBalance, paidCredits, unpaidCredits, waitingAction, inprocess, success, rejected, cancelled } = req.body;

        // Fetch the user's existing data, including the old balance
        const existingUser = await User.findById(userId);

        if (!existingUser) {
            return res.status(404).send('User not found');
        }

        // Calculate the new balance by adding the new balance to the old balance
        const updatedBalance = existingUser.balance + parseFloat(newBalance);

        // Update the user information in your database, including the new balance
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                name,
                username,
                isAdmin,
                balance: updatedBalance, // Update the balance with the new calculated balance
                paidCredits,
                unpaidCredits,
                waitingAction,
                inprocess,
                success,
                rejected,
                cancelled
            },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).send('User not found');
        }

        res.redirect('/users'); // Redirect back to the users list
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal server error');
    }
});



// DELETE route to delete an IMEI


app.get('/users/:userId/imeiOrder-delete/:imeiOrderId', isAdmin, async (req, res) => {
    const userId = req.params.userId;
    const imeiId = req.params.imeiOrderId;

    try {
        // Find the user by ID and delete the specified IMEI entry
        const user = await User.findOneAndUpdate(
            { _id: userId },
            { $pull: { imei: { _id: imeiId } } },
            { new: false } // Return the original document before the update
        );

        if (!user) {
            // User not found
            return res.status(404).send('User not found');
        }

        // Find the deleted IMEI entry in the original user document
        const deletedImei = user.imei.find(imei => imei._id.toString() === imeiId);
        
        if (!deletedImei) {
            // IMEI entry not found
            return res.status(404).send('IMEI not found');
        }

            // Update user balance by adding the deleted order's price
            const updatedBalance = user.balance + deletedImei.price;

            // Update the user's balance
            await User.findByIdAndUpdate(userId, { balance: updatedBalance });

            console.log("Deleted IMEI:", deletedImei);
            console.log("Updated Balance:", updatedBalance);

        console.log("Deleted IMEI:", deletedImei);
        
        res.redirect('/users'); // Redirect to the home page or another appropriate route

    } catch (error) {
        // Handle errors appropriately
        console.error(error);
        res.status(500).send('Internal Server Error');
    }

});

//edit imei 
app.get('/users/:userId/imeiOrder-edit/:imeiOrderId', isAdmin, async (req, res) => {
    const userId = req.params.userId;
    const imeiId = req.params.imeiOrderId;

    try {
        // Find the user by ID and delete the specified IMEI entry
        const user = await User.findOneAndUpdate(
            { _id: userId },
            { $pull: { imei: { _id: imeiId } } },
            { new: false } // Return the original document before the update
        );

        if (!user) {
            // User not found
            return res.status(404).send('User not found');
        }
        
         const imeiOrders = user.imei || [];
       
        // Find the deleted IMEI entry in the original user document
        const detectedImei = user.imei.find(imei => imei._id.toString() === imeiId);
        
        if (!detectedImei) {
            // IMEI entry not found
            return res.status(404).send('IMEI not found');
        }


        console.log("edited IMEI:", detectedImei);
        res.render('imei-status-edit',{user , detectedImei,userId: userId })
       
    } catch (error) {
        // Handle errors appropriately
        console.error(error);
        res.status(500).send('Internal Server Error');
    }

});

app.post('/editedimei/:userId', isAdmin, async (req, res) => {
    try {
        const { detectedImei, detectedStatus,detectedService,detectedPrice } = req.body;
        const userId = req.params.userId;

        console.log(userId)
        const user = await User.findById(userId);
        

        // Save the new IMEI to the user's array
        user.imei.push({
            imeiNumber: detectedImei,
            status:detectedStatus,
            price:detectedPrice,
            service:detectedService
            
        });

        // Save the updated user to the database
        await user.save();
        

        res.redirect('/users'); // Redirect to a success page
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});


app.get('/users/:userId/user-delete', isAdmin, async (req, res) => {
    try {
        const userId = req.params.userId;

        // Find the user by ID
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).send('User not found');
        }

        // Check if the user is an admin
        if (user.isAdmin) {
            // Admin users cannot be deleted
            return res.status(403).send('Admin users cannot be deleted');
        }

        // Delete the user from the database
        const deletedUser = await User.findByIdAndRemove(userId);

        if (!deletedUser) {
            return res.status(404).send('User not found');
        }

        // Redirect back to the users list or any other appropriate page
        res.redirect('/users');
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal server error');
    }
});




//gets method
app.get('/',(req,res)=>{
    res.render('home')
})
app.get('/services',(req,res)=>{
    res.render('services')
})
app.get('/downloads',(req,res)=>{
    res.render('downloads')
})
app.get('/orders',(req,res)=>{
    if (req.isAuthenticated()) {

        // Assuming you have a user model
        User.findOne({ _id: req.user._id }, (err, user) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Internal Server Error');
            }
            
            if (!user) {
                return res.status(404).send('User not found');
            }

            // Render the 'dash' template and pass the user data
             // Fetch the balance data
             
             let balance = user.balance || 0; 
 
             // Render the 'dash' view and pass the user and balance data
             res.render('orders', { user: user, balance: balance});
         
        });
    } else {
        res.redirect('/');
    }

})

//POST route for submitting the order




app.post('/orders', async (req, res) => {
    if (req.isAuthenticated()) {
        const userId = req.user.id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let selectedDevice = req.body.device;
        let userBalance = user.balance

        const selectedService = req.body.selectedService;   
        const newImeiNumber = req.body.imei;

        const BOT_TOKEN = '6518093800:AAErTtdV6RIN6VVMSNL5sVQis_T5BOpx8oQ';
        const GROUP_CHAT_ID = '-1001822240487';
        const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        

        if (selectedDevice <= userBalance) {
            
            user.balance -= selectedDevice;
            selectedDevice = parseFloat(selectedDevice);
            user.paidCredits += selectedDevice;

            // Push IMEI to the user's array with initial status 'waiting'
            user.imei.push({ imeiNumber: newImeiNumber, status: 'waiting' , price: selectedDevice, service:selectedService});

            console.log('After all changes:',user)
            await user.save();
            

            user.waitingAction += 1; // Increment the waiting action count
            await user.save();


         // Schedule a job to change status to 'inprocess' after 1 minute
        schedule.scheduleJob(new Date(Date.now() + 3 * 60 * 1000), async () => {
            const index = user.imei.findIndex(entry => entry.imeiNumber === newImeiNumber);
            if (index !== -1 && user.imei[index].status === 'waiting') {
                user.imei[index].status = 'inprocess';
                try {
                    await user.save();
                    console.log('IMEI status changed to inprocess:', newImeiNumber);

                } catch (error) {
                    console.error('Error saving user after changing status to inprocess:', error);
                }
            }
        });

// Send message to group chat about new device being added
// Initialize Telegram bot
const botToken = '6518093800:AAErTtdV6RIN6VVMSNL5sVQis_T5BOpx8oQ';
const chatId = '-1001822240487';
const bot = new TelegramBot(botToken);


// Function to send Telegram message
async function sendTelegramMessage(message1) {
    try {
        await bot.sendMessage(chatId, message1);
        console.log('Telegram message sent:', message1);
    } catch (error) {
        console.error('Error sending Telegram message:', error);
        // Handle the error appropriately, e.g., notify admin or log it
    }
}

// Schedule a job to change status to 'inprocess' after 2 minutes
schedule.scheduleJob(new Date(Date.now() + 10 * 60 * 60 * 1000 + 2 * 60 * 1000), async () => {
    const index = user.imei.findIndex(entry => entry.imeiNumber === newImeiNumber);
    if (index !== -1 && user.imei[index].status === 'waiting') {
        user.imei[index].status = 'inprocess';
        try {
            await user.save();
            console.log('IMEI status changed to inprocess:', user.imei[index]);

            // Notify Telegram group about the status change
            const message1 = `Hello ${req.user.name},IMEI status changed to inprocess: ${user.imei[index]}`;
            sendTelegramMessage(message);
        } catch (error) {
            console.error('Error saving user after changing status to inprocess:', error);
            // Handle the error appropriately, e.g., notify admin or log it
        }
    }
});

// Schedule a job to change status to 'rejected' after 2 minutes
schedule.scheduleJob(new Date(Date.now() + 10 * 60 * 60 * 1000 + 4 * 60 * 1000), async () => {
    const index = user.imei.findIndex(entry => entry.imeiNumber === newImeiNumber);
    if (index !== -1 && user.imei[index].status === 'inprocess') {
        user.imei[index].status = 'rejected';
        try {
            await user.save();
            console.log('IMEI status changed to rejected:', user.imei[index]);

            // Notify Telegram group about the status change
            const message = `IMEI status changed to rejected: ${user.imei[index]}`;
            sendTelegramMessage(message);
        } catch (error) {
            console.error('Error saving user after changing status to rejected:', error);
            // Handle the error appropriately, e.g., notify admin or log it
        }
    }
});
            // Send a confirmation email to the user
            const userEmail = req.user.username;
            const lastImei = user.imei.length > 0 ? user.imei[user.imei.length - 1] : { imeiNumber: 'N/A', price: 0 };
            const subject = 'IMEI Order Confirmation';
            const message = `Your IMEI order was successfully placed. Your order details: Imei: ${lastImei.imeiNumber} Price: $ ${lastImei.price}`;

            const emailTemplate = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Order Confirmation</title>
                    </head>
                    <body style="font-family: Arial, sans-serif;">

                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <h2 style="color: #4CAF50;">Order Successfully Placed</h2>
                        </div>

                        <div style="padding: 20px;">
                            <p>Your IMEI order was successfully placed. Here are your order details:</p>
                            
                            <ul style="list-style-type: none; padding: 0; margin: 0;">
                                <li>IMEI: <strong>${lastImei.imeiNumber}</strong></li>
                                <li>Service: <strong>${lastImei.service}</strong></li> 
                                <li>Price: <strong>$ ${lastImei.price}</strong></li>
                                <li>Status: <strong>${lastImei.status}</strong></li>  
                            </ul>
                        </div>

                        <div style="background-color: #f8f8f8; padding: 20px; text-align: center;">
                            <p style="color: #888;">Thank you for choosing our service!</p>
                        </div>

                    </body>
                    </html>
                `;


            const transporter = nodemailer.createTransport({
                service: 'gmail',
                port: 456,
                secure: true,
                auth: {
                    user: "darkunlocks1@gmail.com",
                    pass: "nnzw lyec ivtj soyw"
                }
            });

            const mailOptions = {
                from: 'darkunlocks1@gmail.com',
                to: userEmail,
                subject: subject,
                html: emailTemplate,
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Error sending email notification:', error);
                } else {
                    console.log('Email notification sent:', info.response);
                }
            });

            async function sendMessage(message) {
                try {
                  const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      chat_id: GROUP_CHAT_ID,
                      text: message,
                    }),
                  });
              
                  const data = await response.json();
                  console.log(data);
              
                  if (!data.ok) {
                    console.error('Failed to send message:', data.description);
                  }
                } catch (error) {
                  console.error('Error sending message:', error.message);
                }
              }
              
             // Example usage
             const maskedImeiNumber = newImeiNumber.slice(0, -8) + "********";

             console.log(`Masked IMEI:   ${maskedImeiNumber}`);
              
              // Message with Markdown-style formatting for emphasis
const messageToSend = `🌟 NEW IMEI ORDER by ${req.user.name}! 🌟\n\n**Order Info** 🚀\n
SERVICE: ${selectedService}\n\nPRICE: $${selectedDevice}\n\nIMEI: ${maskedImeiNumber}\n\nYou can also view on our website: https://darkunlocks.onrender.com 🌐\n\n 🙏 Thanks Dark Unlocks 🔓`;


              sendMessage(messageToSend);    
           

            // Send a success response with the updated balance
            return res.redirect('/order-sucessfully');
        } else {
            // User doesn't have enough balance
            return res.render('insufficient-balance');
        }
    } else {
        // User is not authenticated, handle accordingly
        res.redirect('/login');
    }
});




app.get('/order-sucessfully', async (req, res) => {
    // Retrieve the user's waiting action and inprocess counts
    if (req.isAuthenticated()) {
        const userId = req.user.id;
        
       
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let balance = user.balance;
        
         balance = balance.toFixed(1)

         
          const lastImei = user.imei.length > 0 ? user.imei[user.imei.length - 1] : { imeiNumber: 'N/A', price: 0 };
          
          console.log(lastImei.imeiNumber);
          console.log(lastImei.price);
          console.log(lastImei.service);
          console.log(lastImei.status);


            
        // Render the HTML with the counts
        res.render('order-sucessfully', {balance, lastImei});
    } else {
        // User is not authenticated, handle accordingly
        res.redirect('/login');
    }
})
// Assuming this is your 'view-orders' route
app.get('/view-orders', async (req, res) => {
    // Retrieve the user's waiting action and inprocess counts
    if (req.isAuthenticated()) {
        const userId = req.user.id;

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Map the IMEI list with color information
        const imeiList = user.imei.map(imeiObject => ({
            imeiNumber: imeiObject.imeiNumber,
            status: imeiObject.status,
            service:imeiObject.service,
            price:imeiObject.price,
            color: getColor(imeiObject.status),
        }));
       

        const waitingActionCount = user.waitingAction;
        const inprocessCount = user.inprocess;
        const successCount = user.success;
        const rejectedCount = user.rejected
        const date = user.addedAt;

        // Render the HTML with the counts and IMEI list
        res.render('view-orders', {
            waitingActionCount,
            inprocessCount,
            successCount,
            date,
            user,
            imeiList,
            rejectedCount 
        });
    } else {
        // User is not authenticated, handle accordingly
        res.redirect('/login');
    }
});




app.get('/profile', (req, res) => {
    if (req.isAuthenticated()) {
      // Fetch the current user's information (e.g., from req.user)
      const currentUser = req.user; // Assuming you have user information in req.user
  
      // Render the profile page and pass the user data
      res.render('profile', { user: currentUser });
  
    } else {
      res.redirect('/');
    }
  });




app.get('/dash', (req, res) => {
    if (req.isAuthenticated()) {

        // Assuming you have a user model
        User.findOne({ _id: req.user._id }, (err, user) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Internal Server Error');
            }
            
            if (!user) {
                return res.status(404).send('User not found');
            }
            

            // Render the 'dash' template and pass the user data
             // Fetch the balance data
             let balance = user.balance || 0; 
             balance = balance.toFixed(1)
            
             const paidCredits = user.paidCredits || 0;
             const unpaidCredits = user.unpaidCredits || 0;
             const waitingAction = user.waitingAction || 0;
             const  inprocess = user.inprocess || 0;
             const success = user.success || 0;
             const rejected = user.rejected || 0;
             const cancelled = user.cancelled || 0;
             
             const allOrders = waitingAction + inprocess + success + rejected + cancelled
             let totalBalance = (user.balance || 0) + (user.paidCredits || 0) + (user.unpaidCredits || 0);

              totalBalance = totalBalance.toFixed(1)
           

             // Render the 'dash' view and pass the user and balance data
             res.render('dash', { user: user, balance: balance, paidCredits: paidCredits, unpaidCredits: unpaidCredits , waitingAction: waitingAction ,inprocess:inprocess ,success:success,rejected:rejected, cancelled:cancelled , allOrders:allOrders , totalBalance});
         
        });
    } else {
        res.redirect('/');
    }
});

app.get('/login',(req,res)=>{
    const errorMessage = req.flash('error')[0];
    res.render('login',{errorMessage})
})
app.get('/logout',(req,res)=>{
    req.logout((err)=>{
        if(err){
            console.log(err)
            res.redirect('/dash')
        }else{
            res.redirect('/')
        }
    })
})
app.get('/credits',(req,res)=>{

    if (req.isAuthenticated()) {
        res.render('credits')

   }else{
       res.redirect('/');
   }
})


let amount ;
let totalAmount = {}


//Post methoods
  

app.post('/pay', ensureAuthenticated, (req, res) => {
    // Parse the amount from the request body
     amount = parseFloat(req.body.amount);

    // Check if the amount is a valid number
    if (isNaN(amount) || amount <= 0) {
        return res.status(400).send('Invalid amount');
    }

    // Construct the amount object
     totalAmount = {
        currency: 'USD',
        total: amount.toFixed(2) // Format total as a string with two decimal places
    };

    // Construct the payment request
    const paymentRequest = {
        intent: 'sale',
        payer: {
            payment_method: 'paypal'
        },
        redirect_urls: {
            return_url: 'https://darkunlocks.onrender.com/payment_success',
            cancel_url: 'https://darkunlocks.onrender.com/payment_error'
        },
        transactions: [{
            item_list: {
                items: [{
                    name: 'Credits',
                    sku: 'credits',
                    price: totalAmount.total,
                    currency: totalAmount.currency,
                    quantity: 1
                }]
            },
            amount: totalAmount,
            description: 'Buying credits'
        }]
    };

    // Create the payment
    paypal.payment.create(paymentRequest, (error, payment) => {

        if (error) {
            console.error('Error occurred while creating payment:', error);
            return res.status(500).send('Internal Server Error');
        }

        // Redirect to PayPal approval URL
        const approvalUrl = payment.links.find(link => link.rel === 'approval_url');

        if (!approvalUrl) {
            console.error('Approval URL not found in the PayPal response.');
            return res.status(500).send('Internal Server Error');
        }
        console.log('Payment created sucessfully')
        res.redirect(approvalUrl.href);
    });
});

//stripe payment
let due;
let amountInCents;
app.post('/visa',ensureAuthenticated,(req,res)=>{
    const user = req.user
    due = parseFloat(req.body.amount)

    function convertDollarsToCents(amountInDollars) {
        // Convert the dollar amount to cents
        let amountInCents = Math.round(amountInDollars * 100); // Round to handle decimal precision issues
      
        return amountInCents;
      }
      
    
      amountInCents = convertDollarsToCents(due);
      console.log(amountInCents); // Output: 1000 (represents $10 in cents)
      
      
      
    console.log(due)

   

    res.render('visa',{user ,key:PUBLISHABLE_KEY, due,amountInCents})
  })


app.get('/visa', ensureAuthenticated, async(req, res) => {

    console.log(req.query.amount, typeof req.query.amount);
    console.log("email:", req.query.stripeEmail);
    console.log("strip:", req.query.stripeToken);

    stripe.customers.create({
        email: req.query.stripeEmail,
        source: req.query.stripeToken,
        name: req.user.name,
        address: {
            line1: '1155 South Street',
            postal_code: "0002",
            city: 'Pretoria',
            state: 'Gauteng',
            country: 'South Africa'
        }
    }, (err, customer) => {
        if (err) {
            console.error(err);
            return res.redirect('/payment_error');
        }
        
        console.log(customer);
        
        stripe.charges.create({
            amount: amountInCents,
            description: "Buying crdits on dark unlocks",
            currency: 'USD',
            customer: customer.id,
        }, async(err, charge) => {
            if (err) {
                console.error(err);
                return res.send(err);
            }
            
        console.log(charge);
        const userId = req.user._id
            // Retrieve the user by their ID
        const user = await User.findById(userId);

        if (!user) {
            console.error("User not found.");
            return res.redirect('/payment_error');
        }

        // Determine the new contract based on the amount
        console.log(amountInCents)
         amount = due


        // Update user's contract and totalSpent
        user.balance = user.balance + due;
        
        
    
        // Save the updated user
        await user.save();

        // Send confirmation email to the user
        
        res.render("payment_success", { user, amount,due });
        });
    });
});

app.post('/mastercard',ensureAuthenticated,(req,res)=>{
  const amount =   req.body.amount
  const user = req.user
    res.render('skrill',{amount,user})
})

// Payment success route
app.get('/payment_success', async (req, res) => {
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;
    const userId = req.user._id;

    // Check if payerId, paymentId, and userId are valid
    if (!payerId || !paymentId || !userId) {
        console.error("Invalid parameters.");
        return res.redirect('/payment_cancel');
    }

    const execute_payment_json = {
        "payer_id": payerId,
        "transactions": [{
            "amount": totalAmount
        }]
    };

    console.log("payerId:", payerId);
    console.log("amount:", totalAmount);

    paypal.payment.execute(paymentId, execute_payment_json, async (err, payment) => {
        if (err) {
            console.error(err.response);
            return res.redirect('/payment_error');

        } else {

            console.log("Payment successful");
            console.log(JSON.stringify(payment));

            try {
                // Retrieve the user by their ID
                const user = await User.findById(userId);

                if (!user) {
                    console.error("User not found.");
                    return res.redirect('/payment_error');
                }

                // Calculate the updated balance by adding the payment amount to the current balance
                
                console.log("total amount while updating :", amount)
                const updatedBalance = user.balance + amount;

                console.log('New balance:', updatedBalance);

                // Update the user's balance in the database
                await User.findByIdAndUpdate(userId, { balance: updatedBalance });

                // Format the date and time
                const currentTimestamp = Date.now();
                const currentDate = new Date(currentTimestamp);

                const formattedDateTime = currentDate.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short'
                });

                // Send a confirmation email to the user
                const userEmail = req.user.username; // Assuming you have the user's email address
                const subject = 'New payment received from your website';
                const message = `A new user ${userEmail} has added $${amount} credits`;

                // Create a transporter object using your email credentials
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: "darkunlocks1@gmail.com",
                        pass: "nnzw lyec ivtj soyw"
                    }
                });

                // Create and send the email notification
                const mailOptions = {
                    from: 'darkunlocks1@gmail.com',
                    to: 'strongadas009@gmail.com',
                    subject: subject,
                    text: message,
                };

                const info = await transporter.sendMail(mailOptions);
                console.log('Email notification sent:', info.response);

                // Render the success page with the updated balance
                res.render("success", { amount: amount, paymentId, formattedDateTime, balance: updatedBalance });
            } catch (error) {
                console.error('Error occurred while processing user or sending email:', error);
                res.redirect('/payment_error');
            }
        }
    });
});



app.get('/payment_error', ensureAuthenticated,(req, res) => {
    const paymentStatus = req.query.status; // Get the payment status query parameter
    console.log("payment ",paymentStatus)
    // Render the 'cancelled' view with the payment status
    res.render('cancelled');
});

app.post('/profile', (req, res) => {
    if (req.isAuthenticated()) {
      const { name, username } = req.body;
  
      // Validate the request data
      if (!name || !username) {
        return res.status(400).json({ error: 'Name and username are required' });
      }
  
      // Fetch the current user's information (e.g., from req.user)
      const currentUser = req.user; // Assuming you have user information in req.user
  
      // Update user information using findOneAndUpdate
      User.findOneAndUpdate(
        { _id: currentUser._id }, // Find the user by their ID
        { name: name, username: username }, // Update the name and email
        { new: true }, // Return the updated user document
        (err, updatedUser) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Server error' });
          }
  
          if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
          }
  
          // Render the profile page with the updated user data
          res.render('profile', { user: updatedUser });
        }
      );
    } else {
      res.redirect('/');
    }
  });
  
  // Handle form submission
  app.post('/process_payment', ensureAuthenticated,upload.single('proof'), (req, res) => {
    // Check if a file has been uploaded
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    // Extract data from the form
    const userEmail = req.body.email;
    const proofFile = req.file;

    const BOT_TOKEN = '6518093800:AAErTtdV6RIN6VVMSNL5sVQis_T5BOpx8oQ';
    const GROUP_CHAT_ID = '-1001822240487';
    const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    // Configure Nodemailer
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'darkunlocks1@gmail.com',
            pass: 'nnzw lyec ivtj soyw'
        }
    });

    // Prepare the email
    const mailOptions = {
        from: req.user.username,
        to: 'darkunlocks1@gmail.com',
        subject: 'Payment Proof',
        text: `User ${req.user.username} has added through Skrill`,
        attachments: [
            {
                filename: 'proof.png',
                content: proofFile.buffer,
                encoding: 'base64'
            }
        ]
    };

    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
            return res.status(500).send('Internal Server Error');
        }

        console.log('Email sent:', info.response);

        async function sendMessage(message) {
            try {
              const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  chat_id: GROUP_CHAT_ID,
                  text: message,
                }),
              });
          
              const data = await response.json();
              console.log(data);
          
              if (!data.ok) {
                console.error('Failed to send message:', data.description);
              }
            } catch (error) {
              console.error('Error sending message:', error.message);
            }
          }
          
         // Example usage
          
const messageToSend = `🎁 Hello @darkunlocksOwner \n\ ${req.user.name}! has added credits with the skrill method! 🚀\n\n please chcek your email and verify thanks! .\n\n Our Official Website : https://darkunlocks.onrender.com 🌐`;


          sendMessage(messageToSend);  


        // Render the "email-sent" view
        res.render('email-sent');
    });
});

app.post('/AMEX',ensureAuthenticated,(req,res)=>{
    const user = req.user
    const amount = req.body.amount

    res.render("usdt",{user,amount})
})
app.post('/usdt', ensureAuthenticated,upload.single('proof'), (req, res) => {
    // Check if a file has been uploaded
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    // Extract data from the form
    const userEmail = req.body.email;
    const proofFile = req.file;

    const BOT_TOKEN = '6518093800:AAErTtdV6RIN6VVMSNL5sVQis_T5BOpx8oQ';
    const GROUP_CHAT_ID = '-1001822240487';
    const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    // Configure Nodemailer
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'darkunlocks1@gmail.com',
            pass: 'nnzw lyec ivtj soyw'
        }
    });

    // Prepare the email
    const mailOptions = {
        from: req.user.username,
        to: 'darkunlocks1@gmail.com',
        subject: 'Payment Proof',
        text: `User ${req.user.username} has added through USDT MANUAL METHOD`,
        attachments: [
            {
                filename: 'proof.png',
                content: proofFile.buffer,
                encoding: 'base64'
            }
        ]
    };

    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
            return res.status(500).send('Internal Server Error');
        }

        console.log('Email sent:', info.response);

        async function sendMessage(message) {
            try {
              const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  chat_id: GROUP_CHAT_ID,
                  text: message,
                }),
              });
          
              const data = await response.json();
              console.log(data);
          
              if (!data.ok) {
                console.error('Failed to send message:', data.description);
              }
            } catch (error) {
              console.error('Error sending message:', error.message);
            }
          }
          
         // Example usage
          
const messageToSend = `🎁 Hello @darkunlocksOwner \n\ ${req.user.name}! has added credits with the USDT MANUAL method! 🚀\n\n please chcek your email and verify thanks! .\n\n Our Official Website : https://darkunlocks.onrender.com 🌐`;


          sendMessage(messageToSend);  


        // Render the "email-sent" view
        res.render('email-sent');
    });
});
  


  app.post('/',(req,res)=>{

    const { username, password, name } = req.body;

    const newUser = new User({ username, name });

    const BOT_TOKEN = '6518093800:AAErTtdV6RIN6VVMSNL5sVQis_T5BOpx8oQ';
    const GROUP_CHAT_ID = '-1001822240487';
    const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    
    // Use Passport's register method to add the user to the database
    User.register(newUser, password, (err, user) => {
        if (err) {
            console.log(err);
            res.redirect('/');
            
        } else {
            
            passport.authenticate('local')(req, res, () => {
                res.redirect('/dash');
                console.log(req.body)


                async function sendMessage(message) {
                    try {
                      const response = await fetch(API_URL, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                          chat_id: GROUP_CHAT_ID,
                          text: message,
                        }),
                      });
                  
                      const data = await response.json();
                      console.log(data);
                  
                      if (!data.ok) {
                        console.error('Failed to send message:', data.description);
                      }
                    } catch (error) {
                      console.error('Error sending message:', error.message);
                    }
                  }
                  
                 // Example usage
                  
const messageToSend = `🌟 New Registered User 🌟\n\nHello, ${req.body.name}! Welcome to Dark Unlocks! 🚀 Remember to always deal with our admins only.\nYou can also register on our website: https://darkunlocks.onrender.com 🌐`;


                  sendMessage(messageToSend);    
                

            });
        }
    });
})

app.post('/login', passport.authenticate('local', {
    successRedirect: '/dash', // Redirect to '/dash' upon successful login
    failureRedirect: '/login',      // Redirect to '/' if authentication fails
    failureFlash: true         // Enable flash messages for failed authentication

    
}));


const PORT = process.env.PORT || 3000


app.listen(PORT,(err)=>{
    if(err){
        console.log(err + "while sarting the server")
    }
    console.log('Server started on port 3000')
   
})