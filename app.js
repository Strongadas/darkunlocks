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

paypal.configure({
    mode: 'live', 
    client_id:  process.env.PAYPAL_CLIENT_ID ,
    client_secret: process.env.PAYPAL_SECRET_KEY
})



const app = express()


mongoose.connect(process.env.DATABASE_URL)
mongoose.set('strictQuery', false);


app.use(express.static('public'))
app.set('view engine','ejs')
app.set('views', __dirname + '/views')
app.use(bodyParser.urlencoded({extended:true}))

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
        default: 0, // You can set a default balance if needed
    },
    paidCredits: {type:Number,default:0},
    unpaidCredits: {type:Number,default:0},
    isAdmin: { type: Boolean, default: false },
    waitingAction: {type:Number,default:0},
    inprocess:{type:Number,default:0},
    success:{type:Number,default:0},
    rejected:{type:Number,default:0},
    cancelled:{type:Number,default:0},
    imeiNumbers: [{ type: String }],
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


//// Schedule a job to run every 10 minutes
const job = schedule.scheduleJob('*/3 * * * *', async () => {
    // Implement logic to remove waiting actions and increase inprocess here
    // For example:
    
    const users = await User.find({ waitingAction: { $gt: 0 } });

    for (const user of users) {
        user.inprocess += user.waitingAction;
        user.waitingAction = 0;
        user.addedAt = new Date();
        await user.save();
    }
});



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

        // Render the user edit template and pass the user data
        res.render('user-edit', { user });
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




// Define the route for user deletion
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
             const balance = user.balance || 0; 
             
            
             
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
        // Assuming you have user authentication and user ID available in req.user
        const userId = req.user.id;
        console.log('User ID:', userId);
        // Retrieve user's balance from the database
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let selectedDevice = req.body.device;
        const orderPrice = parseFloat(req.body.device_price); // Parse the order price from the form data
        const userBalance = user.balance;
        const imei = req.body.imei

        
        console.log(selectedDevice)
        console.log(orderPrice)
        console.log(userBalance)
        console.log(imei)

        

        if (selectedDevice <= userBalance) {
            // User has enough balance, process the order here
            // Deduct the order price from the user's balance
            user.balance -= selectedDevice;// Subtract the order price from the user's balance
            // Convert user.paidCredits to a number before addition
             
             selectedDevice = parseFloat(selectedDevice);
             

            user.paidCredits += selectedDevice  
            await user.save();

            user.waitingAction += 1; // Increment the waiting action count
            await user.save();

            
              // Send a confirmation email to the user
            const userEmail = req.user.username; // Assuming you have the user's email address
            const subject = 'IMEI Order Confirmation';
            const message = `Your IMEI order was sucessfully placed . Your order details: ${imei}`;
                         
                // Create a transporter object using your Gmail credentials
                const transporter = nodemailer.createTransport({
                    service:'gmail',
                    port:456,
                    secure:true,
                    auth:{
                        user: "darkunlocks1@gmail.com",
                        pass:"nnzw lyec ivtj soyw"
                    }
                })
                
                // Create and send the email notification
                const mailOptions = {
                  from: 'darkunlocks1@gmail.com',
                  to: userEmail, // Replace with your notification recipient's email
                  subject: subject,
                  text: message ,
                };
                
                transporter.sendMail(mailOptions, (error, info) => {
                  if (error) {
                    console.error('Error sending email notification:', error);
                  } else {
                    console.log('Email notification sent:', info.response);
                  }
                });
                
            // Send a success response with the updated balance
            return res.redirect('/order-sucessfully');

        } else {
            // User doesn't have enough balance
            return res.render('insufficient-balance'); // Render the GUI page

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

        const balance = user.balance;
        

        // Render the HTML with the counts
        res.render('order-sucessfully', {balance});
    } else {
        // User is not authenticated, handle accordingly
        res.redirect('/login');
    }
})
app.get('/view-orders', async (req, res) => {
    // Retrieve the user's waiting action and inprocess counts
    if (req.isAuthenticated()) {
        const userId = req.user.id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const waitingActionCount = user.waitingAction;
        const inprocessCount = user.inprocess;
        const successCount = user.success
        const date = user.addedAt

        // Render the HTML with the counts
        res.render('view-orders', { waitingActionCount, inprocessCount , successCount ,date});
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
             res.render('dash', { user: user, balance: balance, paidCredits: paidCredits, unpaidCredits: unpaidCredits , waitingAction: waitingAction ,inprocess:inprocess ,success:success,rejected:rejected, cancelled:cancelled , allOrders:allOrders , totalBalance});
         
        });
    } else {
        res.redirect('/');
    }
});

app.get('/login',(re,res)=>{
    res.render('login')
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


// Define a middleware to check if the user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    // Redirect unauthenticated users to the login page or any other appropriate route
    res.redirect('/login');
}


//Post methoods
let amount ;
let totalAmount = {}
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
            return res.redirect('/payment_cancel');

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

                const dateOptions = {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                };
                const formattedDate = currentDate.toLocaleDateString('en-US', dateOptions);

                const timeOptions = {
                    hour: 'numeric',
                    minute: '2-digit',
                };
                const formattedTime = currentDate.toLocaleTimeString('en-US', timeOptions);

                // Send a confirmation email to the user
                const userEmail = req.user.username; // Assuming you have the user's email address
                const subject = 'New payment received from your website';
                const message = `A new user ${userEmail} has added $${totalAmount} credits`;

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
                res.render("success", { amount: amount, paymentId, formattedTime, formattedDate, balance: updatedBalance });
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
  
  



//



app.post("/", (req, res) => {
    // Extract username, password, and name from the registration form
    const { username, password, name } = req.body;

    // Create a new user object with name, username, and password
    const newUser = new User({ username, name });

    // Use Passport's register method to add the user to the database
    User.register(newUser, password, (err, user) => {
        if (err) {
            console.log(err);
            res.redirect('/');
            
        } else {
            
            passport.authenticate('local')(req, res, () => {
                res.redirect('/dash');
                
                // Create a transporter object using your Gmail credentials
                const transporter = nodemailer.createTransport({
                    service:'gmail',
                    port:456,
                    secure:true,
                    auth:{
                        user: "teamdevelopers72@gmail.com",
                        pass:"tpqe yuyw rvnt cxmi"
                    }
                })
                
                // Create and send the email notification
                const mailOptions = {
                  from: 'strongadas009@gmail.com',
                  to: 'dopegang004@gmail.com', // Replace with your notification recipient's email
                  subject: 'New User Signup',
                  text: ' A new user has signed up on your website !' + username,
                };
                
                transporter.sendMail(mailOptions, (error, info) => {
                  if (error) {
                    console.error('Error sending email notification:', error);
                  } else {
                    console.log('Email notification sent:', info.response);
                  }
                });
                

            });
        }
    });
});

app.post('/login',(req,res)=>{

    const user = new User({
        username:req.body.username,
        password:req.body.password
    })
    
    req.login(user,(err)=>{

        if(err){
            console.log(err)
            res.redirect('/login')
        }else{
            passport.authenticate('local')(req,res,()=>{
                res.redirect('/dash')
            })
        }
    })
})


const PORT = process.env.PORT || 3000
app.listen(PORT,(err)=>{
    if(err){
        console.log(err + "while sarting the server")
    }
    console.log('Server started on port 3000')
})