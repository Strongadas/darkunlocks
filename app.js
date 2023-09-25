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
    balance: {type:Number,default:0},
    paidCredits: {type:Number,default:0},
    unpaidCredits: {type:Number,default:0},
    isAdmin: { type: Boolean, default: false }
});
userSchema.plugin(passportLocalMongoose)

const User = new mongoose.model('User',userSchema)

passport.use(User.createStrategy())
passport.serializeUser(function(user, done) {
    done(null, user);
  });
  
  passport.deserializeUser(function(user, done) {
    done(null, user);
  });


  const isAdmin = (req, res, next) => {
    if (req.isAuthenticated() && req.user.isAdmin) {
        return next(); // User is an admin, proceed to the next middleware
    }
    res.redirect('/dash'); // Redirect to the home page or login page if not an admin
};

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

        // Fetch the balance data
        const { balance = 0, paidCredits = 0, unpaidCredits = 0 } = user;

        // Render the 'admin' view and pass the user and balance data
        res.render('admin', { user, balance, paidCredits, unpaidCredits });
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
        // Parse the form data and update user information in the database
        const { name, username, isAdmin, balance } = req.body;


        // Update the user information in your database (e.g., using Mongoose)
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { name, username, isAdmin , balance},
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
// Import necessary modules and User model

// Define the route for user deletion

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
        res.render('orders')
    }else{
        res.redirect('/');
    }
})
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
             
           
             
             // Render the 'dash' view and pass the user and balance data
             res.render('dash', { user: user, balance: balance, paidCredits: paidCredits, unpaidCredits: unpaidCredits });
         
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


//Post methoods
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
                const nodemailer = require('nodemailer');

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