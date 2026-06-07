import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
//main.jsx = MainActivity launcher
//App.jsx = MainScreen Composable
/***User opens website                  User opens app
       ↓                                 AndroidManifest
index.html                                 MainActivity
       ↓                                      setContentAppNavigation
  main.jsx                                              ↓
       ↓                                          Screens
  Components                                          ↓
       ↓                                           ViewModel
    Firebase                                           ↓
       ↓                                         Repository
 Data shown                                           ↓
                                                 Firebase
        

   
       
   Component = Composable

Props = Parameters

useState = mutableStateOf

useEffect = LaunchedEffect

React Router = Navigation Compose

Firebase = Firebase

       

| Android            | React Web                   |
| ------------------ | --------------------------- |
| AndroidManifest    | index.html                  |
| MainActivity       | main.jsx                    |
| setContent{}       | ReactDOM.render()           |
| App() Composable   | App.jsx, component                   |
| ViewModel          | useState/useReducer/Context |
| Retrofit           | fetch/axios                 |
| Room               | LocalStorage/IndexedDB      |
| Firebase           | Firebase                    |
| Navigation Compose | React Router                |
 */