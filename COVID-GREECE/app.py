from flask import Flask, render_template, request
import requests
import ijson
import os
import random
import pickle


app = Flask(__name__)

 
 
@app.route('/')
def index():
    
    
    url = 'https://api.covid19api.com/summary'
    r = requests.get(url).json()
    
    yey = 0
    xyz = 0
    hehehe = 1000000000
    while xyz < hehehe:
     valuefordef = r['Countries'][yey]['Slug']
     xyz += 1
     yey += 1
     if valuefordef == 'greece':
         xyz = hehehe
    yey -= 1
  
  





    greekcases = {
        'country' : r['Countries'][yey]['Country'],
        'TotalConfirmed': r['Countries'][yey]['TotalConfirmed'],
        'TotalDeaths': r['Countries'][yey]['TotalDeaths'],
        'TotalRecovered': r['Countries'][yey]['TotalRecovered'],
        'Newcases' :r['Countries'][yey]['NewConfirmed']
        }
    #8===================================================================D
    
    urlgreece = 'https://api.covid19api.com/country/greece'
    gr = requests.get(urlgreece).json()
    length = len(gr)
    a = gr    
    key = 0
    stringcases = []
    stringdates = []
    stringdeaths = []
    stringclosed = []
    
    while key < length:
     valuecases = a[key]['Confirmed']
     stringcases.append(valuecases)
     #=====================================================================#
     valuedeaths = gr[key]['Deaths']
     stringdeaths.append(valuedeaths)
     #===============================================
     valueclosed = a[key]['Recovered']
     stringclosed.append(valueclosed)
     #==============================================
     valuedates = a[key]['Date']
     stringdates.append(valuedates[5:10])
     key += 1 
   
    datesreplaced = str(stringdates).replace("-", "/")
    graphdata_for_cases = stringcases
    graphdata_for_dates = datesreplaced
    graphdata_for_deaths = stringdeaths
    graphdata_for_closed = stringclosed
    img = './static/download.svg'
    

    

    return render_template('index.html',graphdata_for_dates = graphdata_for_dates ,greekcases = greekcases  ,graphdata_for_cases = graphdata_for_cases, graphdata_for_deaths = graphdata_for_deaths, graphdata_for_closed = graphdata_for_closed, img = img)

if __name__ == "__main__":
    app.run()








#country = 'Greece'
   # url = 'https://api.covid19api.com/summary'
   # r = requests.get(url.format(country)).json()
#https://api.covid19api.com/dayone/country/greece/status/confirmed
#https://api.covid19api.com/summary