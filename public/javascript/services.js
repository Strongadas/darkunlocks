document.addEventListener("DOMContentLoaded", function () {
    const serviceSelect = document.getElementById("serviceSelect");
    const serviceDetails = document.getElementById("serviceDetails");

    serviceSelect.addEventListener("change", function () {
        const selectedService = serviceSelect.value;

        // Define service data (order, delivery time, and price) based on the selected option
        const serviceData = getServiceData(selectedService);

        // Generate a table and update the serviceDetails container
        const tableHTML = `
            <h2>${selectedService}</h2>
            <table class="table">
                <thead>
                    <tr>
                        <th>Order</th>
                        <th>Delivery Time</th>
                        <th>Price</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${serviceData.order}</td>
                        <td>${serviceData.deliveryTime}</td>
                        <td>${serviceData.price}</td>
                    </tr>
                </tbody>
            </table>
        `;

        serviceDetails.innerHTML = tableHTML;
    });

    // Function to define service data (order, delivery time, and price) based on the selected option
    function getServiceData(service) {
        // Replace this with your actual service data
        switch (service) {
            case "service1":
                return {
                    order: "Service 1 Order Info",
                    deliveryTime: "Service 1 Delivery Time",
                    price: "$X.XX",
                };
            case "service2":
                return {
                    order: "Service 2 Order Info",
                    deliveryTime: "Service 2 Delivery Time",
                    price: "$XX.XX",
                };
            case "service3":
                return {
                    order: "Service 3 Order Info",
                    deliveryTime: "Service 3 Delivery Time",
                    price: "$XXX.XX",
                };
            default:
                return {
                    order: "N/A",
                    deliveryTime: "N/A",
                    price: "N/A",
                };
        }
    }
});
