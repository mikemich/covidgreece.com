import requests


url = 'https://api.covid19api.com/summary'
r = requests.get(url).json()
formated = r['Countries'][84]['']
print(formated)
    





while key < length:
     value = a[key]['Confirmed']
     a[key]['Confirmed'] = value
     key += 1 

     datesreplaced = str(stringdates).replace("-", "/")sumcases = gr[key]['Confirmed']
    
    
    
    sumdeaths = gr[key]['Deaths']
    sumrecovered = gr[key]['Recovered']
    
    greekcases = greekcases

    <span class="totalconfirmed">{{ greekcases.TotalConfirmed }}</span>
  <span class="totaldeaths">{{ greekcases.TotalDeaths }}</span>
  <span class="totalrecovered">{{ greekcases.TotalRecovered }}</span>
  [0:10]



  <script>
  var ctx = document.getElementById('myChart').getContext('2d');
  var chart = new Chart(ctx, {
    // The type of chart we want to create
    type: 'line',

    // The data for our dataset
    data: {
        labels: {{graphdata_for_dates}},
        datasets: [{
            label: 'Κρούσματα Covid-19 (Ελλάδα)',
            backgroundColor: 'rgb(255, 99, 132)',
            borderColor: 'rgb(255, 99, 132)',
            data: {{graphdata_for_dates}}
        }]
    },
     //{{ graphdata_for_cases }}
    // Configuration options go here
    options: {}
});
</script>